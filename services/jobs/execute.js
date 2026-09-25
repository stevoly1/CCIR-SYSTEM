const { OutboxEntry } = require('../../models');
const registry = require('./registry');
const { toJobError } = require('./jobError');
const { getLogger } = require('../../utils/logger');

const FINISHED = new Set(['DONE', 'FAILED', 'DISMISSED']);

// Runs one entry's handler and records what happened. Handlers are written to be safe to repeat,
// because a queue can deliver a job twice. A job for an older runKey (before an administrator's
// retry) is skipped.
const executeEntry = async (entryId, { runKey, attempt, maxAttempts }) => {
  const entry = await OutboxEntry.findById(entryId);
  if (!entry || FINISHED.has(entry.state) || entry.runKey !== runKey) return 'skipped';
  const handler = registry.handlerFor(entry.type);
  const started = Date.now();
  const log = { event: 'job', queue: entry.queue, type: entry.type, entryId: String(entry._id), attempt };
  try {
    await handler.run(entry);
  } catch (error) {
    const jobError = toJobError(error);
    jobError.final = !jobError.retryable || attempt >= maxAttempts;
    await OutboxEntry.updateOne({ _id: entry._id, runKey }, {
      $set: { attempts: attempt, lastErrorCode: jobError.code, lastErrorAt: new Date(), ...(jobError.final ? { state: 'FAILED' } : {}) },
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
    getLogger()[jobError.final ? 'warn' : 'info']({ ...log, outcome, failureCode: jobError.code, durationMs: Date.now() - started }, 'Job did not succeed');
    throw jobError;
  }
  await OutboxEntry.updateOne({ _id: entry._id, runKey }, {
    $set: { state: 'DONE', doneAt: new Date(), attempts: attempt },
    $unset: { 'refs.email': 1 },
  });
  getLogger().info({ ...log, outcome: 'done', durationMs: Date.now() - started }, 'Job done');
  return 'done';
};

module.exports = { executeEntry };
