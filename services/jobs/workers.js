const { Worker } = require('bullmq');
const { QUEUE_NAMES, DEFAULT_POLICY } = require('./queues');
const { executeEntry } = require('./execute');
const { JobError } = require('./jobError');
const { getLogger } = require('../../utils/logger');

// Idle cost on a per-command Redis (Upstash): a worker long-polls an empty queue for drainDelay
// seconds (a new job wakes it at once), and checks for stalled jobs every stalledInterval. These
// are the values Upstash's BullMQ guide suggests; measured in the command-budget test.
const IDLE_SETTINGS = { drainDelay: 300, stalledInterval: 300 * 1000 };

const UNLIMITED = { max: 1000, duration: 1000 };

const backoffFor = ({ backoffBaseMs, backoffCapMs }) => (attempt) => Math.min(backoffBaseMs * 2 ** Math.max(0, attempt - 1), backoffCapMs);

// Each job is one attempt of one outbox entry. Retries and give-ups are recorded in the outbox by
// executeEntry, so the BullMQ job itself always completes, except when recording fails: then it
// fails, is removed, and the relay re-offers the entry later.
const createWorkers = ({ connection, queues, policy = DEFAULT_POLICY, idle = IDLE_SETTINGS, lockDuration }) => {
  const workers = QUEUE_NAMES.map((name) => {
    const settings = policy[name];
    const retryDelayMs = backoffFor(settings);
    const worker = new Worker(name, async (job) => {
      try {
        return await executeEntry(job.data.entryId, {
          runKey: job.data.runKey, attempt: job.data.attempt, maxAttempts: settings.attempts, retryDelayMs,
        });
      } catch (error) {
        if (!(error instanceof JobError)) {
          getLogger().error({ event: 'job_crashed', queue: name, entryId: job.data.entryId, err: error }, 'Job could not be run or recorded');
          throw error;
        }
        if (error.code === 'RATE_LIMITED' && !error.final) {
          // The provider asked everyone to wait: hold the whole queue, not only this entry.
          await queues[name].rateLimit(error.retryAfterMs ?? retryDelayMs(job.data.attempt));
        }
        return error.final ? 'failed' : 'retrying';
      }
    }, {
      connection,
      concurrency: settings.concurrency,
      // BullMQ honours queue.rateLimit() only on a queue with a limiter, so there always is one.
      limiter: settings.limiter ?? UNLIMITED,
      drainDelay: idle.drainDelay,
      stalledInterval: idle.stalledInterval,
      ...(lockDuration ? { lockDuration } : {}),
    });
    worker.on('error', (err) => getLogger().warn({ event: 'worker_error', queue: name, err }, 'Queue worker error'));
    return worker;
  });
  return { workers, close: (force = false) => Promise.all(workers.map((worker) => worker.close(force))).then(() => undefined) };
};

module.exports = { IDLE_SETTINGS, backoffFor, createWorkers };
