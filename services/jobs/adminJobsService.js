// The handlers' retry steps are needed here, in the API process, where no worker has loaded them.
require('./handlers');
const { Complaint, EmailChange, OutboxEntry, User } = require('../../models');
const registry = require('./registry');
const JOB_TYPES = require('./jobTypes');
const { checkBackground } = require('../readinessService');
const { inTransaction } = require('../../utils/transaction');
const { jobNotFailed } = require('../../errors/domainErrors');
const { NotFoundError } = require('../../errors');
const { getLogger } = require('../../utils/logger');

const STATES = ['PENDING', 'QUEUED', 'DONE', 'FAILED', 'DISMISSED'];
// From the job types rather than the queue module, so the API never loads the queue library.
const QUEUE_NAMES = [...new Set(Object.values(JOB_TYPES))];
const RETRY_ALL_LIMIT = 100;

// What an administrator may see: a report's reference or an account's name. Never an address.
const subjectsFor = async (entries) => {
  const complaintIds = entries.map((e) => e.refs.complaintId).filter(Boolean);
  const changeIds = entries.map((e) => e.refs.emailChangeId).filter(Boolean);
  const [complaints, changes] = await Promise.all([
    Complaint.find({ _id: { $in: complaintIds } }).select('referenceCode'),
    EmailChange.find({ _id: { $in: changeIds } }).select('user'),
  ]);
  const changeUser = new Map(changes.map((c) => [String(c._id), String(c.user)]));
  const userIds = [...entries.map((e) => e.refs.userId).filter(Boolean), ...changeUser.values()];
  const users = await User.find({ _id: { $in: userIds } }).select('name');
  const reference = new Map(complaints.map((c) => [String(c._id), c.referenceCode]));
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  return (entry) => {
    if (entry.refs.complaintId) return { kind: 'report', id: entry.refs.complaintId, label: reference.get(entry.refs.complaintId) ?? 'Deleted report' };
    const userId = entry.refs.userId ?? changeUser.get(entry.refs.emailChangeId);
    if (userId) return { kind: 'account', id: userId, label: name.get(userId) ?? 'Deleted account' };
    return { kind: 'account', label: 'Password reset request' };
  };
};

const present = (entry, subjectOf) => ({
  id: String(entry._id),
  queue: entry.queue,
  type: entry.type,
  state: entry.state,
  attempts: entry.attempts,
  lastErrorCode: entry.lastErrorCode ?? null,
  lastErrorAt: entry.lastErrorAt ?? null,
  createdAt: entry.createdAt,
  subject: subjectOf(entry),
});

const presentOne = async (id) => {
  const entry = await OutboxEntry.findById(id);
  return present(entry, await subjectsFor([entry]));
};

const listJobs = async ({ state, queue, page, limit }) => {
  const filter = { state, ...(queue ? { queue } : {}) };
  const [entries, total] = await Promise.all([
    OutboxEntry.find(filter).sort({ lastErrorAt: -1, createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    OutboxEntry.countDocuments(filter),
  ]);
  const subjectOf = await subjectsFor(entries);
  return { jobs: entries.map((entry) => present(entry, subjectOf)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const summary = async () => {
  const counts = await OutboxEntry.aggregate([{ $group: { _id: { queue: '$queue', state: '$state' }, n: { $sum: 1 } } }]);
  const queues = Object.fromEntries(QUEUE_NAMES.map((name) => [name, Object.fromEntries(STATES.map((s) => [s, 0]))]));
  for (const { _id, n } of counts) if (queues[_id.queue]) queues[_id.queue][_id.state] = n;
  const { oldestPendingSeconds, workerLastSeenSeconds } = await checkBackground();
  return { queues, oldestPendingSeconds, workerLastSeenSeconds };
};

const loadFailed = async (id) => {
  const entry = await OutboxEntry.findById(id);
  if (!entry) throw new NotFoundError('Job not found');
  if (entry.state !== 'FAILED') throw jobNotFailed();
  return entry;
};

// The job runs again from its first attempt under a new runKey, so an older delivery of it is
// skipped. Its handler's onRetry reopens the work it belongs to, in the same transaction, or
// refuses with JOB_CANNOT_RETRY; any other error is a real failure and answers as one.
const retryJob = async (id, actorId) => {
  const entry = await loadFailed(id);
  await inTransaction(async (session) => {
    await registry.handlerFor(entry.type).onRetry?.(entry, session);
    const moved = await OutboxEntry.updateOne(
      { _id: entry._id, state: 'FAILED' },
      { $set: { state: 'PENDING', attempts: 0 }, $inc: { runKey: 1 }, $unset: { lastErrorCode: 1, lastErrorAt: 1, queuedAt: 1, notBefore: 1 } },
      { session },
    );
    if (moved.modifiedCount !== 1) throw jobNotFailed();
  });
  getLogger().info({ event: 'job_retried', entryId: String(entry._id), by: String(actorId) }, 'Job retried by an administrator');
  return presentOne(entry._id);
};

const dismissJob = async (id, actorId, reason) => {
  const entry = await loadFailed(id);
  const moved = await OutboxEntry.updateOne(
    { _id: entry._id, state: 'FAILED' },
    { $set: { state: 'DISMISSED', dismissedAt: new Date(), dismissedBy: actorId, dismissReason: reason } },
  );
  if (moved.modifiedCount !== 1) throw jobNotFailed();
  getLogger().info({ event: 'job_dismissed', entryId: String(entry._id), by: String(actorId) }, 'Job dismissed by an administrator');
  return presentOne(entry._id);
};

// Oldest failures first, at most 100 a call. A job that cannot be retried is counted as skipped;
// a real failure stops the batch and answers as one.
const retryFailedJobs = async (queue, actorId) => {
  const entries = await OutboxEntry.find({ queue, state: 'FAILED' }).sort({ lastErrorAt: 1, _id: 1 }).limit(RETRY_ALL_LIMIT).select('_id');
  let retried = 0;
  let skipped = 0;
  for (const { _id } of entries) {
    try {
      await retryJob(_id, actorId);
      retried += 1;
    } catch (error) {
      if (error?.statusCode !== 409) throw error;
      skipped += 1;
    }
  }
  return { retried, skipped };
};

module.exports = { listJobs, summary, retryJob, dismissJob, retryFailedJobs };
