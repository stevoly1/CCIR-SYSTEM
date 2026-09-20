const mongoose = require('mongoose');
const { AdminControl, Complaint, RefreshToken, User } = require('../models');
const { buildUserSnapshot } = require('./userSnapshotService');
const { BadRequestError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');

const CONTROL_ID = 'administrator-lifecycle';
const TERMINAL_STATUSES = new Set(['RESOLVED', 'REJECTED']);

const normalizeReason = (reason) => {
  if (reason === undefined) return undefined;
  if (typeof reason !== 'string') throw new BadRequestError('Retirement reason must be a string');
  const normalized = reason.trim();
  if (!normalized || normalized.length > 500) {
    throw new BadRequestError('Retirement reason must contain 1 to 500 characters');
  }
  return normalized;
};

const ensureControlDocument = async () => {
  try {
    await AdminControl.updateOne(
      { _id: CONTROL_ID },
      { $setOnInsert: { revision: 0 } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
};

const touchAdministratorGuard = (session) => AdminControl.updateOne(
  { _id: CONTROL_ID },
  { $inc: { revision: 1 } },
  { session },
);

const requireActiveAdministrator = (actor) => {
  if (!actor || actor.role !== 'admin' || actor.isActive === false || actor.retiredAt) {
    throw new ForbiddenError('An active administrator is required');
  }
};

const preserveSnapshotsAndAssignments = async ({ target, actor, reason, session, now }) => {
  const targetSnapshot = buildUserSnapshot(target);
  const actorSnapshot = buildUserSnapshot(actor);
  const complaints = await Complaint.find({
    $or: [
      { reporter: target._id },
      { 'statusHistory.changedBy': target._id },
      { assignedTo: target._id },
    ],
  }).session(session);

  for (const complaint of complaints) {
    if (String(complaint.reporter) === String(target._id) && !complaint.reporterSnapshot) {
      complaint.reporterSnapshot = targetSnapshot;
    }
    for (const entry of complaint.statusHistory) {
      if (String(entry.changedBy) === String(target._id) && !entry.changedBySnapshot) {
        entry.changedBySnapshot = targetSnapshot;
      }
    }
    if (
      target.role === 'agency'
      && String(complaint.assignedTo) === String(target._id)
      && !TERMINAL_STATUSES.has(complaint.status)
    ) {
      complaint.assignedTo = null;
      complaint.assignmentHistory.push({
        type: 'RETIREMENT_UNASSIGNMENT',
        previous: targetSnapshot,
        next: null,
        changedBy: actorSnapshot,
        reason: reason || 'Account retired',
        createdAt: now,
      });
    }
    await complaint.save({ session });
  }
};

const retireAccount = async ({ targetUserId, actorUserId, reason }) => {
  const normalizedReason = normalizeReason(reason);
  await ensureControlDocument();
  const session = await mongoose.startSession();
  let retiredUser;

  try {
    await session.withTransaction(async () => {
      await touchAdministratorGuard(session);
      const [target, actor] = await Promise.all([
        User.findById(targetUserId).select('+password').session(session),
        User.findById(actorUserId).session(session),
      ]);
      if (!target) throw new NotFoundError('User not found');
      if (!actor) throw new ForbiddenError('Actor not found');
      if (target.retiredAt) throw new ConflictError('Account is already retired');

      const self = String(target._id) === String(actor._id);
      if (self && target.role === 'admin') {
        throw new ConflictError('Administrators cannot retire their own accounts');
      }
      if (!self) requireActiveAdministrator(actor);

      if (target.role === 'admin') {
        const activeAdmins = await User.countDocuments({
          role: 'admin',
          isActive: { $ne: false },
          retiredAt: null,
        }).session(session);
        if (activeAdmins <= 1) throw new ConflictError('The final active administrator cannot be retired');
      }

      const now = new Date();
      await preserveSnapshotsAndAssignments({ target, actor, reason: normalizedReason, session, now });
      await RefreshToken.deleteMany({ user: target._id }, { session });

      target.name = 'Retired account';
      target.email = `retired+${target._id}@invalid.local`;
      target.isActive = false;
      target.retiredAt = now;
      target.retiredBy = actor._id;
      target.retirementReason = normalizedReason;
      target.password = undefined;
      target.googleId = undefined;
      target.phone = undefined;
      target.avatarUrl = undefined;
      await target.save({ session });
      retiredUser = target;
    });
  } finally {
    await session.endSession();
  }

  return retiredUser;
};

const mutateAdministrator = async ({ targetUserId, actorUserId, changes }) => {
  await ensureControlDocument();
  const session = await mongoose.startSession();
  let updatedUser;

  try {
    await session.withTransaction(async () => {
      await touchAdministratorGuard(session);
      const [target, actor] = await Promise.all([
        User.findById(targetUserId).session(session),
        User.findById(actorUserId).session(session),
      ]);
      if (!target) throw new NotFoundError('User not found');
      requireActiveAdministrator(actor);

      const removesAdministrator = target.role === 'admin'
        && (changes.role && changes.role !== 'admin' || changes.isActive === false);
      if (String(target._id) === String(actor._id) && removesAdministrator) {
        throw new ConflictError('Administrators cannot demote or deactivate themselves');
      }
      if (removesAdministrator) {
        const activeAdmins = await User.countDocuments({
          role: 'admin',
          isActive: { $ne: false },
          retiredAt: null,
        }).session(session);
        if (activeAdmins <= 1) throw new ConflictError('The final active administrator cannot be changed');
      }

      Object.assign(target, changes);
      await target.save({ session });
      if (changes.isActive === false || Object.hasOwn(changes, 'role')) {
        await RefreshToken.deleteMany({ user: target._id }, { session });
      }
      updatedUser = target;
    });
  } finally {
    await session.endSession();
  }

  return updatedUser;
};

module.exports = { mutateAdministrator, retireAccount };
