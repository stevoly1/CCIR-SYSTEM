const { ConflictError, ForbiddenError } = require('../errors');
const { buildUserSnapshot } = require('../services/userSnapshotService');

const isActive = (user) => Boolean(user) && user.isActive !== false && !user.retiredAt;

const decideAssignment = ({ actor, target, currentAssignee, reason, now = new Date() }) => {
  if (!isActive(actor) || actor.role !== 'admin') {
    throw new ForbiddenError('Assignment requires an active administrator');
  }

  if (target && (!isActive(target) || target.role !== 'agency')) {
    throw new ConflictError('Assignment target is not an active agency user');
  }

  if (target && currentAssignee && String(target._id) === String(currentAssignee._id)) {
    throw new ConflictError('Complaint is already assigned to this user');
  }

  const type = !currentAssignee ? 'ASSIGNED' : !target ? 'UNASSIGNED' : 'REASSIGNED';

  return {
    assignedTo: target?._id ?? null,
    event: {
      type,
      previous: buildUserSnapshot(currentAssignee),
      next: buildUserSnapshot(target),
      changedBy: buildUserSnapshot(actor),
      reason: reason || undefined,
      createdAt: now,
    },
  };
};

module.exports = { decideAssignment };
