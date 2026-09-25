const mongoose = require('mongoose');
const { Complaint, RefreshToken, User } = require('../models');
const { buildUserSnapshot } = require('./userSnapshotService');
const {
  ensureAccountLifecycleGuard,
  touchAccountLifecycleGuard,
} = require('./accountLifecycleGuard');
const { BadRequestError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { cancelTokens } = require('./accountTokenService');

const TERMINAL_STATUSES = new Set(['RESOLVED', 'REJECTED', 'WITHDRAWN']);
const RETIRED_NAME = 'Retired account';

const scrubName = (snapshot, userId) => {
  if (snapshot && String(snapshot.userId) === String(userId)) snapshot.displayName = RETIRED_NAME;
};

const normalizeReason = (reason) => {
  if (reason === undefined) return undefined;
  if (typeof reason !== 'string') throw new BadRequestError('Retirement reason must be a string');
  const normalized = reason.trim();
  if (!normalized || normalized.length > 500) {
    throw new BadRequestError('Retirement reason must contain 1 to 500 characters');
  }
  return normalized;
};

const normalizeEmail = (email) => email.trim().toLowerCase();

const requireActiveAdministrator = (actor) => {
  if (!actor || actor.role !== 'admin' || actor.isActive === false || actor.retiredAt) {
    throw new ForbiddenError('An active administrator is required');
  }
};

const preserveSnapshotsAndAssignments = async ({ target, actor, reason, session, now, scrub }) => {
  const targetSnapshot = buildUserSnapshot(target);
  const actorSnapshot = buildUserSnapshot(actor);
  const complaints = await Complaint.find({
    $or: [
      { reporter: target._id },
      { 'statusHistory.changedBy': target._id },
      { assignedTo: target._id },
      { 'editHistory.editedBy.userId': target._id },
      { 'assignmentHistory.changedBy.userId': target._id },
      { 'assignmentHistory.previous.userId': target._id },
      { 'assignmentHistory.next.userId': target._id },
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
    // A citizen who deletes their own account takes their name with them. Staff names stay, whoever
    // retires the account: who handled a report is the agency's record (owner decision). Screens show
    // any retired person as "Retired account" either way.
    if (scrub) {
      scrubName(complaint.reporterSnapshot, target._id);
      for (const entry of complaint.statusHistory) scrubName(entry.changedBySnapshot, target._id);
      for (const entry of complaint.assignmentHistory) {
        scrubName(entry.changedBy, target._id);
        scrubName(entry.previous, target._id);
        scrubName(entry.next, target._id);
      }
      for (const entry of complaint.editHistory) scrubName(entry.editedBy, target._id);
    }
    await complaint.save({ session });
  }
};

const retireAccount = async ({ targetUserId, actorUserId, reason }) => {
  const normalizedReason = normalizeReason(reason);
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let retiredUser;

  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
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
      await preserveSnapshotsAndAssignments({ target, actor, reason: normalizedReason, session, now, scrub: self && target.role === 'citizen' });
      await RefreshToken.deleteMany({ user: target._id }, { session });
      await cancelTokens({ userId: target._id, session });

      target.name = 'Retired account';
      target.email = `retired+${target._id}@invalid.local`;
      target.isActive = false;
      target.retiredAt = now;
      target.retiredBy = actor._id;
      target.retirementReason = normalizedReason;
      // The suspension note is free text about the person, so it goes with their other details.
      target.suspendedAt = undefined;
      target.suspendedBy = undefined;
      target.suspensionReason = undefined;
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

const mutateAdministrator = async ({ targetUserId, actorUserId, changes, reason }) => {
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let updatedUser;

  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const [target, actor] = await Promise.all([
        User.findById(targetUserId).session(session),
        User.findById(actorUserId).session(session),
      ]);
      if (!target) throw new NotFoundError('User not found');
      requireActiveAdministrator(actor);
      if (target.retiredAt) throw new ConflictError('Retired accounts cannot be changed');

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

      const removesAgencyEligibility = target.role === 'agency' && (
        changes.isActive === false
        || Boolean(changes.role && changes.role !== 'agency')
      );
      if (removesAgencyEligibility) {
        const openAssignments = await Complaint.countDocuments({
          assignedTo: target._id,
          status: { $nin: [...TERMINAL_STATUSES] },
        }).session(session);
        if (openAssignments > 0) {
          throw new ConflictError('Unassign open complaints before changing this agency account');
        }
      }

      // Sessions end only when authority really changes: an edit that repeats the current role
      // (the admin form always sends it) must not sign the user out.
      const roleChanged = Object.hasOwn(changes, 'role') && changes.role !== target.role;
      if (changes.isActive === false && target.isActive === false && reason) {
        throw new ConflictError('This account is already suspended; reactivate it first to record a new reason');
      }
      if (changes.isActive === false && target.isActive !== false) {
        target.suspendedAt = new Date();
        target.suspendedBy = actor._id;
        target.suspensionReason = reason;
      } else if (changes.isActive === true) {
        target.suspendedAt = undefined;
        target.suspendedBy = undefined;
        target.suspensionReason = undefined;
      }
      Object.assign(target, changes);
      await target.save({ session });
      if (changes.isActive === false || roleChanged) {
        await RefreshToken.deleteMany({ user: target._id }, { session });
      }
      updatedUser = target;
    });
  } finally {
    await session.endSession();
  }

  return updatedUser;
};

const mutateUserDetails = async ({ targetUserId, actorUserId, changes, selfMutation = false }) => {
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let updatedUser;

  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const [target, actor] = await Promise.all([
        User.findById(targetUserId).select('+password').session(session),
        User.findById(actorUserId).session(session),
      ]);
      if (!target) throw new NotFoundError('User not found');
      if (target.retiredAt) throw new ConflictError('Retired accounts cannot be changed');

      if (selfMutation) {
        if (!actor || String(actor._id) !== String(target._id) || actor.isActive === false || actor.retiredAt) {
          throw new ForbiddenError('An active account is required');
        }
      } else {
        requireActiveAdministrator(actor);
      }

      Object.assign(target, changes);
      await target.save({ session });
      updatedUser = target;
    });
  } finally {
    await session.endSession();
  }

  return updatedUser;
};

const bootstrapFirstAdministrator = async ({ targetEmail }) => {
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let updatedUser;

  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const target = await User.findOne({ email: normalizeEmail(targetEmail) }).session(session);
      if (!target) throw new NotFoundError('User not found');
      if (target.retiredAt || target.isActive === false) {
        throw new ConflictError('Only an active account can become the first administrator');
      }
      if (target.role !== 'citizen') {
        throw new ConflictError('Only a citizen account can become the first administrator');
      }

      const activeAdministrators = await User.countDocuments({
        role: 'admin',
        isActive: { $ne: false },
        retiredAt: null,
      }).session(session);
      if (activeAdministrators > 0) {
        throw new ConflictError('The first administrator has already been created; use the administrator API');
      }

      target.role = 'admin';
      await target.save({ session });
      await RefreshToken.deleteMany({ user: target._id }, { session });
      updatedUser = target;
    });
  } finally {
    await session.endSession();
  }

  return updatedUser;
};

module.exports = {
  bootstrapFirstAdministrator,
  mutateAdministrator,
  mutateUserDetails,
  requireActiveAdministrator,
  retireAccount,
};
