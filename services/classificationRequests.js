const { Complaint, OutboxEntry } = require('../models');
const { enqueue } = require('./jobs/outbox');
const { jobCannotRetry } = require('../errors/domainErrors');

const REPLACED = 'Replaced by a newer classification request';

// Write the current request's job in the caller's transaction and retire obsolete failed jobs.
const enqueueClassification = async (session, complaint, { reuseEntry } = {}) => {
  const complaintId = String(complaint._id);
  const requestSeq = complaint.ai.requestSeq;
  await OutboxEntry.updateMany(
    { type: 'classify_report', 'refs.complaintId': complaintId, state: 'FAILED', ...(reuseEntry ? { _id: { $ne: reuseEntry._id } } : {}) },
    { $set: { state: 'DISMISSED', dismissedAt: new Date(), dismissReason: REPLACED } },
    { session },
  );
  if (reuseEntry) {
    await OutboxEntry.updateOne({ _id: reuseEntry._id }, { $set: { 'refs.requestSeq': requestSeq } }, { session });
    return reuseEntry;
  }
  return enqueue(session, { queue: 'ai', type: 'classify_report', refs: { complaintId, requestSeq } });
};

// Return null if a newer state no longer matches `where`; otherwise increment the request and
// write its job atomically with the status change.
const requestClassification = async ({ session, complaintId, where = {}, reuseEntry }) => {
  const complaint = await Complaint.findOneAndUpdate(
    { _id: complaintId, ...where },
    { $inc: { 'ai.requestSeq': 1 }, $set: { 'ai.status': 'PENDING' }, $unset: { 'ai.failureCode': 1, 'ai.failedAt': 1 } },
    { session, returnDocument: 'after' },
  );
  if (!complaint) return null;
  await enqueueClassification(session, complaint, { reuseEntry });
  return complaint;
};

const classificationRetry = async (entry, session) => {
  const again = await requestClassification({
    session, complaintId: entry.refs.complaintId, where: { 'ai.requestSeq': entry.refs.requestSeq }, reuseEntry: entry,
  });
  if (!again) throw jobCannotRetry();
};

// Final failure changes only the current pending request. A provisional Other becomes FALLBACK;
// citizen and staff categories remain theirs.
const recordClassificationFailure = async ({ complaintId, requestSeq }, code) => {
  const failed = { 'ai.status': 'FAILED', 'ai.failureCode': code, 'ai.failedAt': new Date() };
  await Complaint.updateOne({ _id: complaintId, 'ai.requestSeq': requestSeq, categorySource: 'PENDING' }, { $set: { ...failed, categorySource: 'FALLBACK' } });
  await Complaint.updateOne({ _id: complaintId, 'ai.requestSeq': requestSeq, 'ai.status': 'PENDING' }, { $set: failed });
};

module.exports = { enqueueClassification, requestClassification, classificationRetry, recordClassificationFailure };
