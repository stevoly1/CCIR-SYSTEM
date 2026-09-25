const { OutboxEntry } = require('../../models');
const { executeEntry } = require('../../services/jobs/execute');
const { JobError } = require('../../services/jobs/jobError');

const pendingEntries = () => OutboxEntry.find({ state: { $in: ['PENDING', 'QUEUED'] } }).sort({ createdAt: 1, _id: 1 });

// Runs the outbox directly, without Redis: what the workers would do, one entry at a time.
// A retryable failure runs again in the next round until maxAttempts; jobs that create jobs are
// followed until the outbox settles.
const drainOutbox = async ({ maxAttempts = 1, rounds = 10 } = {}) => {
  for (let round = 0; round < rounds; round += 1) {
    const entries = await pendingEntries();
    if (entries.length === 0) return;
    for (const entry of entries) {
      try {
        await executeEntry(entry._id, { runKey: entry.runKey, attempt: entry.attempts + 1, maxAttempts });
      } catch (error) {
        if (!(error instanceof JobError)) throw error;
      }
    }
  }
  throw new Error('The outbox did not settle');
};

module.exports = { drainOutbox, pendingEntries };
