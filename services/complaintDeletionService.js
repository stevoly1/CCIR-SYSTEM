const mongoose = require('mongoose');
const { Complaint, ComplaintDeletion, User } = require('../models');
const CustomError = require('../errors');
const { staleComplaint } = require('../errors/domainErrors');
const uploadService = require('./uploadService');
const { buildUserSnapshot } = require('./userSnapshotService');
const { assertExpectedVersion } = require('./complaintVersionGuard');

// Administrator-only permanent deletion: the audit log entry and the delete commit
// together or not at all. Cloud images are removed best-effort after the commit.
const deleteComplaintPermanently = async ({ complaintId, viewer, reason, expectedVersion }) => {
  const session = await mongoose.startSession();
  let deleted;
  try {
    await session.withTransaction(async () => {
      const complaint = await Complaint.findById(complaintId).session(session);
      if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${complaintId}`);
      assertExpectedVersion(complaint, expectedVersion);
      const admin = await User.findById(viewer.userId).session(session);
      await ComplaintDeletion.create([{
        complaintId: complaint._id,
        referenceCode: complaint.referenceCode,
        statusAtDeletion: complaint.status,
        reporterId: complaint.reporter,
        deletedBy: buildUserSnapshot(admin),
        reason,
        deletedAt: new Date(),
      }], { session });
      const result = await Complaint.deleteOne({ _id: complaint._id, __v: complaint.__v }).session(session);
      if (result.deletedCount !== 1) throw staleComplaint();
      deleted = complaint;
    });
  } finally {
    await session.endSession();
  }

  const publicIds = deleted.images.map((image) => image.publicId);
  if (publicIds.length === 0) return;
  try {
    const failed = await uploadService.deleteComplaintImages(publicIds);
    if (failed?.length) console.error('Complaint image cleanup left orphans:', failed.length);
  } catch (error) {
    console.error('Complaint image cleanup failed after deletion:', error.message);
  }
};

module.exports = { deleteComplaintPermanently };
