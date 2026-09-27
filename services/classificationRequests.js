const { Complaint, OutboxEntry } = require('../models');
const { enqueue } = require('./jobs/outbox');
const { jobCannotRetry } = require('../errors/domainErrors');

const REPLACED = 'Replaced by a newer classification request';
const STALE_AI_RESULT_FIELDS = Object.freeze({
  'ai.suggestedCategory': 1,
  'ai.confidence': 1,
  'ai.summary': 1,
  'ai.tags': 1,
  'ai.classifiedAt': 1,
  'ai.provider': 1,
  'ai.model': 1,
  'ai.promptVersion': 1,
  'ai.inputMode': 1,
  'ai.disagreement': 1,
  'ai.error': 1,
  'ai.failureCode': 1,
  'ai.failedAt': 1,
  'ai.processingToken': 1,
});

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
    { _id: complaintId, status: { $ne: 'WITHDRAWN' }, ...where },
    { $inc: { 'ai.requestSeq': 1 }, $set: { 'ai.status': 'PENDING' }, $unset: STALE_AI_RESULT_FIELDS },
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
const recordClassificationFailure = async ({ complaintId, requestSeq }, code, { processingToken, session } = {}) => {
  const failed = { 'ai.status': 'FAILED', 'ai.failureCode': code, 'ai.failedAt': new Date() };
  const filter = { _id: complaintId, status: { $ne: 'WITHDRAWN' }, 'ai.requestSeq': requestSeq, 'ai.status': 'PENDING',
    ...(processingToken ? { 'ai.processingToken': processingToken } : {}) };
  const update = { $set: failed, $unset: { 'ai.processingToken': 1 } };
  await Complaint.updateOne({ ...filter, categorySource: 'PENDING' }, { ...update, $set: { ...failed, categorySource: 'FALLBACK' } }, { session });
  await Complaint.updateOne(filter, update, { session });
};

module.exports = { enqueueClassification, requestClassification, classificationRetry, recordClassificationFailure, STALE_AI_RESULT_FIELDS };
