const mongoose = require('mongoose');
const { Complaint, User } = require('../models');
const { NotFoundError, ConflictError } = require('../errors');
const { complaintWithdrawn, staleComplaint } = require('../errors/domainErrors');
const { assertExpectedVersion } = require('./complaintVersionGuard');
const { decideAssignment } = require('../policies/assignmentPolicy');
const {
  ensureAccountLifecycleGuard,
  touchAccountLifecycleGuard,
} = require('./accountLifecycleGuard');

const assignComplaintTransaction = async ({ complaintId, actorUserId, assignedTo, reason, expectedVersion }) => {
  const expectedComplaint = await Complaint.findById(complaintId).select('assignedTo status __v');
  if (!expectedComplaint) throw new NotFoundError(`No complaint found with id ${complaintId}`);
  if (expectedComplaint.status === 'WITHDRAWN') throw complaintWithdrawn();
  assertExpectedVersion(expectedComplaint, expectedVersion);
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let assignedComplaint;

  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const complaint = await Complaint.findById(complaintId).populate('assignedTo').session(session);
      const expectedAssignee = expectedComplaint.assignedTo?.toString() ?? null;
      const currentAssignee = complaint?.assignedTo?._id?.toString() ?? complaint?.assignedTo?.toString() ?? null;
      if (!complaint || complaint.__v !== expectedComplaint.__v || currentAssignee !== expectedAssignee) {
        throw staleComplaint();
      }

      const [actor, target] = await Promise.all([
        User.findById(actorUserId).session(session),
        assignedTo === null ? null : User.findById(assignedTo).session(session),
      ]);
      if (assignedTo !== null && !target) {
        throw new NotFoundError(`No user found with id ${assignedTo}`);
      }

      const originalAssignee = complaint.assignedTo;
      if (assignedTo === null && !originalAssignee) {
        throw new ConflictError('Complaint is already unassigned');
      }
      const decision = decideAssignment({ actor, target, currentAssignee: originalAssignee, reason });

      assignedComplaint = await Complaint.findOneAndUpdate(
        {
          _id: complaint._id,
          assignedTo: originalAssignee?._id ?? null,
          __v: complaint.__v,
        },
        {
          $set: { assignedTo: decision.assignedTo },
          $push: { assignmentHistory: decision.event },
          $inc: { __v: 1 },
        },
        { returnDocument: 'after', runValidators: true, session },
      );
      if (!assignedComplaint) {
        throw staleComplaint();
      }
    });
  } finally {
    await session.endSession();
  }

  return assignedComplaint;
};

module.exports = { assignComplaintTransaction };
