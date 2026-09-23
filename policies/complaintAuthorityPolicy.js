const { ALLOWED } = require('./complaintTransitionPolicy');
const { MAX_EDITS } = require('./complaintEditPolicy');

const STAFF_ROLES = new Set(['admin', 'agency']);
const idString = (value) => (value === null || value === undefined ? null : String(value._id ?? value));

const isStaff = (viewer) => STAFF_ROLES.has(viewer?.role);
const isReporter = (viewer, complaint) => Boolean(viewer) && idString(complaint.reporter) === String(viewer.userId);
const canViewComplaint = (viewer, complaint) => isStaff(viewer) || isReporter(viewer, complaint);

// Task 17 narrows agency authority to the current assignee.
const canManageStatus = (viewer) => isStaff(viewer);
const allowedTransitions = (viewer, complaint) => (
  canManageStatus(viewer, complaint) ? [...(ALLOWED[complaint.status] ?? [])] : []
);
const canChangePriority = (viewer, complaint) => canManageStatus(viewer, complaint) && complaint.status !== 'WITHDRAWN';
const canAssign = (viewer, complaint) => viewer?.role === 'admin' && complaint.status !== 'WITHDRAWN';
// Tasks 13-15 refine editing, withdrawal, and deletion.
const canEdit = (viewer, complaint) => isReporter(viewer, complaint)
  && complaint.status === 'PENDING'
  && (complaint.editHistory?.length ?? 0) < MAX_EDITS;
const canWithdraw = () => false;
const canDelete = (viewer, complaint) => isStaff(viewer) || (isReporter(viewer, complaint) && complaint.status === 'PENDING');

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
