require('./handlers');
const { OutboxEntry } = require('../../models');
const registry = require('./registry');
const { JobError, toJobError } = require('./jobError');
const { getLogger } = require('../../utils/logger');

const FINISHED = new Set(['DONE', 'FAILED', 'DISMISSED']);

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
  const handler = registry.handlerFor(entry.type);
  const started = Date.now();
  const log = { event: 'job', queue: entry.queue, type: entry.type, entryId: String(entry._id), attempt };
  try {
    await handler.run(entry);
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
    await OutboxEntry.updateOne({ _id: entry._id, runKey }, {
      $set: { attempts: attempt, lastErrorCode: jobError.code, lastErrorAt: new Date(), ...next },
      // A stored address is kept only while the job may still run; failed entries have no expiry.
      ...(jobError.final ? { $unset: { 'refs.email': 1 } } : {}),
    });
    if (jobError.final && handler.onFinalFailure) {
      // The job's own failure is what callers need; a broken clean-up step is logged beside it.
      try {
        await handler.onFinalFailure(entry, jobError.code);
      } catch (err) {
        getLogger().error({ event: 'job_final_failure_step_failed', entryId: String(entry._id), type: entry.type, err }, 'Job final-failure step failed');
      }
    }
    const outcome = jobError.final ? 'failed' : 'retrying';
    // An unexpected error (a bug, a database timeout) carries what it was; expected failures have their code.
    const detail = error instanceof JobError ? {} : { err: error };
    getLogger()[jobError.final ? 'warn' : 'info']({ ...log, outcome, failureCode: jobError.code, ...detail, durationMs: Date.now() - started }, 'Job did not succeed');
    throw jobError;
  }
  await OutboxEntry.updateOne({ _id: entry._id, runKey }, {
    $set: { state: 'DONE', doneAt: new Date(), attempts: attempt },
    $unset: { 'refs.email': 1, notBefore: 1 },
  });
  getLogger().info({ ...log, outcome: 'done', durationMs: Date.now() - started }, 'Job done');
  return 'done';
};

module.exports = { executeEntry };
