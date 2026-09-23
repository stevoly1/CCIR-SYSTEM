const { ALLOWED } = require('./complaintTransitionPolicy');
const { MAX_EDITS } = require('./complaintEditPolicy');

const STAFF_ROLES = new Set(['admin', 'agency']);
const idString = (value) => (value === null || value === undefined ? null : String(value._id ?? value));

const isStaff = (viewer) => STAFF_ROLES.has(viewer?.role);
const isReporter = (viewer, complaint) => Boolean(viewer) && idString(complaint.reporter) === String(viewer.userId);
const canViewComplaint = (viewer, complaint) => isStaff(viewer) || isReporter(viewer, complaint);

// Administrators act on any complaint; agency staff only on complaints assigned to them.
const canManageStatus = (viewer, complaint) => viewer?.role === 'admin'
  || (viewer?.role === 'agency' && idString(complaint.assignedTo) === String(viewer.userId));
const allowedTransitions = (viewer, complaint) => (
  canManageStatus(viewer, complaint) ? [...(ALLOWED[complaint.status] ?? [])] : []
);
const canChangePriority = (viewer, complaint) => canManageStatus(viewer, complaint) && complaint.status !== 'WITHDRAWN';
const canAssign = (viewer, complaint) => viewer?.role === 'admin' && complaint.status !== 'WITHDRAWN';
const canEdit = (viewer, complaint) => isReporter(viewer, complaint)
  && complaint.status === 'PENDING'
  && (complaint.editHistory?.length ?? 0) < MAX_EDITS;
const canWithdraw = (viewer, complaint) => isReporter(viewer, complaint) && complaint.status === 'PENDING';
const canDelete = (viewer) => viewer?.role === 'admin';

module.exports = {
  isStaff,
  isReporter,
  canViewComplaint,
  canManageStatus,
  allowedTransitions,
  canChangePriority,
  canAssign,
  canEdit,
  canWithdraw,
  canDelete,
};
