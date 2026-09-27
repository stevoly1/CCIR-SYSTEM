const { Complaint, User } = require('../models');
const CustomError = require('../errors');
const { complaintNotEditable, staleComplaint } = require('../errors/domainErrors');
const { buildUserSnapshot } = require('./userSnapshotService');
const { assertExpectedVersion } = require('./complaintVersionGuard');
const authority = require('../policies/complaintAuthorityPolicy');
const { assertEditAllowed, isMaterialChange } = require('../policies/complaintEditPolicy');
const { buildLocation } = require('../validators/locationValidator');
const { inTransaction } = require('../utils/transaction');
const { enqueueClassification, STALE_AI_RESULT_FIELDS } = require('./classificationRequests');

const loadOwnedComplaint = async (complaintId, viewer) => {
  const complaint = await Complaint.findById(complaintId);
  if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${complaintId}`);
  if (!authority.isReporter(viewer, complaint)) {
    throw new CustomError.ForbiddenError('You do not have access to this complaint');
  }
  return complaint;
};

// A conditional write matched nothing: explain whether the complaint left PENDING
// (the reporter can no longer change it) or merely changed underneath us.
const explainMissedWrite = async (complaintId) => {
  const current = await Complaint.findById(complaintId).select('status');
  if (!current || current.status !== 'PENDING') throw complaintNotEditable();
  throw staleComplaint();
};

// Reporter edits of a PENDING complaint. A material description change asks for a new
// classification in the same transaction as the edit. The provider is never called here.
const editComplaint = async ({ complaintId, viewer, changes }) => {
  const complaint = await loadOwnedComplaint(complaintId, viewer);
  if (complaint.status !== 'PENDING') throw complaintNotEditable();
  assertExpectedVersion(complaint, changes.expectedVersion);
  const material = isMaterialChange(complaint.description, changes.description);
  assertEditAllowed({ complaint, material });

  const set = {};
  const fields = [];
  if (changes.description !== undefined && changes.description !== complaint.description) {
    set.description = changes.description;
    fields.push('description');
  }
  if (changes.location) {
    set.location = buildLocation(changes.location);
    fields.push('location');
  }
  if (fields.length === 0) return { complaint, reanalysed: false };

  const editor = await User.findById(viewer.userId);
  const update = {
    $set: set,
    $push: { editHistory: { editedAt: new Date(), editedBy: buildUserSnapshot(editor), fields, reanalysed: material } },
    $inc: { __v: 1 },
  };
  if (material) {
    // Category and priority change only when the classification job answers.
    update.$set['ai.status'] = 'PENDING';
    Object.assign(update.$inc, { 'ai.requestSeq': 1, 'ai.analysisCount': 1 });
    update.$unset = STALE_AI_RESULT_FIELDS;
  }
  const updated = await inTransaction(async (session) => {
    const saved = await Complaint.findOneAndUpdate(
      { _id: complaint._id, reporter: complaint.reporter, status: 'PENDING', __v: complaint.__v },
      update,
      { returnDocument: 'after', runValidators: true, session },
    );
    if (saved && material) await enqueueClassification(session, saved);
    return saved;
  });
  if (!updated) await explainMissedWrite(complaint._id);
  return { complaint: updated, reanalysed: material };
};

const isOwnWithdrawal = (entry, viewer) => entry?.type === 'WITHDRAWN'
  && String(entry.changedBy) === String(viewer.userId);

// The reporter withdraws a PENDING complaint: terminal WITHDRAWN status, history kept,
// any assignee released (recorded), no email. Retrying after success returns success.
const withdrawComplaint = async ({ complaintId, viewer, reason, expectedVersion }) => {
  const complaint = await loadOwnedComplaint(complaintId, viewer);
  if (complaint.status === 'WITHDRAWN' && isOwnWithdrawal(complaint.statusHistory.at(-1), viewer)) return complaint;
  if (complaint.status !== 'PENDING') throw complaintNotEditable();
  assertExpectedVersion(complaint, expectedVersion);

  const now = new Date();
  const reporter = await User.findById(viewer.userId);
  const reporterSnapshot = buildUserSnapshot(reporter);
  const update = {
    $set: { status: 'WITHDRAWN' },
    $push: {
      statusHistory: {
        type: 'WITHDRAWN',
        status: 'WITHDRAWN',
        publicNote: reason || 'Withdrawn by reporter',
        changedBy: reporter._id,
        changedBySnapshot: reporterSnapshot,
        createdAt: now,
      },
    },
    $inc: { __v: 1 },
  };
  if (complaint.assignedTo) {
    const assignee = await User.findById(complaint.assignedTo);
    update.$set.assignedTo = null;
    update.$push.assignmentHistory = {
      type: 'WITHDRAWAL_UNASSIGNMENT',
      previous: buildUserSnapshot(assignee)
        ?? { userId: complaint.assignedTo, displayName: 'Unavailable account', role: 'agency' },
      next: null,
      changedBy: reporterSnapshot,
      createdAt: now,
    };
  }

  const updated = await Complaint.findOneAndUpdate(
    {
      _id: complaint._id,
      reporter: complaint.reporter,
      status: 'PENDING',
      __v: complaint.__v,
      assignedTo: complaint.assignedTo ?? null,
    },
    update,
    { returnDocument: 'after', runValidators: true },
  );
  if (updated) return updated;

  const current = await Complaint.findById(complaint._id);
  if (current?.status === 'WITHDRAWN' && isOwnWithdrawal(current.statusHistory.at(-1), viewer)) return current;
  return explainMissedWrite(complaint._id);
};

module.exports = { editComplaint, withdrawComplaint, loadOwnedComplaint, explainMissedWrite };
