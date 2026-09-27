require('./handlers');
const { randomUUID } = require('node:crypto');
const { OutboxEntry } = require('../../models');
const registry = require('./registry');
const { JobError, toJobError } = require('./jobError');
const { getLogger } = require('../../utils/logger');
const { inTransaction } = require('../../utils/transaction');

const FINISHED = new Set(['DONE', 'FAILED', 'DISMISSED']);
const CLAIM_AFTER_MS = 10 * 60 * 1000;
const STALE_CLAIM = Symbol('stale_claim');

// A handler supplies provenance and the stale-result marker, never arbitrary report or provider text.
const jobLogFields = (reported) => {
  if (!reported || typeof reported !== 'object') return {};
  const fields = {};
  if (typeof reported.provider === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(reported.provider)) fields.provider = reported.provider;
  if (typeof reported.model === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(reported.model)) fields.model = reported.model;
  if (reported.stale === true) fields.stale = true;
  return fields;
};

// Runs one entry's handler and records what happened. Handlers are written to be safe to repeat,
// because a queue can deliver a job twice. A job for an older runKey (before an administrator's
// retry), or for an attempt already recorded, is skipped.
//
// A retryable failure puts the entry back to PENDING with a notBefore time, so the wait happens in
// MongoDB. Waiting in Redis would cost commands: BullMQ polls every 10 seconds while any delayed
// job exists, which on a per-command plan is about 78,000 commands a day.
// onRateLimited(ms) holds the whole queue when the provider asks everyone to wait; it runs before
// the failure is recorded, so no job slips through between the two.
const executeEntry = async (entryId, { runKey, attempt, maxAttempts, retryDelayMs = () => 0, onRateLimited }) => {
  const entry = await OutboxEntry.findById(entryId);
  if (!entry || FINISHED.has(entry.state) || entry.runKey !== runKey || entry.attempts + 1 !== attempt) return 'skipped';
  let handler;
  try {
    handler = registry.handlerFor(entry.type);
  } catch {
    // A worker from another version may receive this type. Record it for the Jobs page.
    const moved = await OutboxEntry.updateOne({ _id: entry._id, runKey, attempts: attempt - 1, state: entry.state }, {
      $set: { state: 'FAILED', attempts: attempt, lastErrorCode: 'UNKNOWN_TYPE', lastErrorAt: new Date() },
      $unset: { 'refs.email': 1 },
    });
    if (moved.modifiedCount !== 1) return 'skipped';
    getLogger().error({ event: 'job_unknown_type', queue: entry.queue, type: entry.type, entryId: String(entry._id) }, 'No handler for this job type');
    const failure = JobError.of('UNKNOWN_TYPE');
    failure.final = true;
    throw failure;
  }
  // The same BullMQ attempt can overlap after a stall or re-offer. Claim it in MongoDB before
  // invoking any handler, and fence terminal writes if an expired claim is taken over later.
  const processingToken = randomUUID();
  const claimed = await OutboxEntry.findOneAndUpdate(
    { _id: entry._id, runKey, attempts: attempt - 1, state: { $in: ['PENDING', 'QUEUED'] },
      $or: [{ processingToken: null }, { processingAt: { $lt: new Date(Date.now() - CLAIM_AFTER_MS) } }] },
    { $set: { processingToken, processingAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!claimed) return 'skipped';
  const started = Date.now();
  const log = { event: 'job', queue: entry.queue, type: entry.type, entryId: String(entry._id), attempt };
  let result;
  try {
    result = await handler.run(entry, { processingToken });
  } catch (error) {
    const jobError = toJobError(error);
    jobError.final = !jobError.retryable || attempt >= maxAttempts;
    const waitMs = jobError.retryAfterMs ?? retryDelayMs(attempt);
    if (jobError.code === 'RATE_LIMITED' && !jobError.final && onRateLimited) {
      // Without the pause the entry still waits its own time; the failure is recorded either way.
      await Promise.resolve(onRateLimited(waitMs)).catch((err) => getLogger().warn({ event: 'queue_pause_failed', queue: entry.queue, err }, 'Could not pause the queue'));
    }
    const next = jobError.final
      ? { state: 'FAILED' }
      : { state: 'PENDING', notBefore: new Date(Date.now() + waitMs) };
    const terminalFilter = { _id: entry._id, runKey, attempts: attempt - 1, processingToken };
    const terminalUpdate = {
      $set: { attempts: attempt, lastErrorCode: jobError.code, lastErrorAt: new Date(), ...next },
      // A stored address is kept only while the job may still run; failed entries have no expiry.
      $unset: { processingToken: 1, processingAt: 1, ...(jobError.final ? { 'refs.email': 1 } : {}) },
    };
    let recorded;
    if (jobError.final && handler.atomicFinalFailure) {
      try {
        recorded = await inTransaction(async (session) => {
          const moved = await OutboxEntry.updateOne(terminalFilter, terminalUpdate, { session });
          if (moved.matchedCount !== 1) throw STALE_CLAIM;
          await handler.onFinalFailure(entry, jobError.code, { processingToken, session });
          return moved;
        });
      } catch (error) {
        if (error === STALE_CLAIM) return 'skipped';
        throw error;
      }
    } else {
      recorded = await OutboxEntry.updateOne(terminalFilter, terminalUpdate);
    }
    if (recorded.matchedCount !== 1) return 'skipped';
    if (jobError.final && handler.onFinalFailure && !handler.atomicFinalFailure) {
      // The job's own failure is what callers need; a broken clean-up step is logged beside it.
      try {
        await handler.onFinalFailure(entry, jobError.code, { processingToken });
      } catch (err) {
        getLogger().error({ event: 'job_final_failure_step_failed', entryId: String(entry._id), type: entry.type, err }, 'Job final-failure step failed');
      }
    }
    const outcome = jobError.final ? 'failed' : 'retrying';
    // An unexpected error (a bug, a database timeout) carries what it was; expected failures have their code.
    const detail = error instanceof JobError ? {} : { err: error };
    getLogger()[jobError.final ? 'warn' : 'info']({ ...log, ...jobLogFields(error?.log), outcome, failureCode: jobError.code, ...detail, durationMs: Date.now() - started }, 'Job did not succeed');
    throw jobError;
  }
  const recorded = await OutboxEntry.updateOne({ _id: entry._id, runKey, attempts: attempt - 1, processingToken }, {
    $set: { state: 'DONE', doneAt: new Date(), attempts: attempt },
    $unset: { 'refs.email': 1, notBefore: 1, processingToken: 1, processingAt: 1 },
  });
  if (recorded.matchedCount !== 1) return 'skipped';
  getLogger().info({ ...log, ...jobLogFields(result?.log), outcome: 'done', durationMs: Date.now() - started }, 'Job done');
  return 'done';
};

module.exports = { executeEntry };
