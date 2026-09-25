const { Worker, UnrecoverableError, RateLimitError } = require('bullmq');
const { QUEUE_NAMES, DEFAULT_POLICY } = require('./queues');
const { executeEntry } = require('./execute');
const { JobError } = require('./jobError');
const { getLogger } = require('../../utils/logger');

// Idle cost on a per-command Redis (Upstash): a worker long-polls an empty queue for drainDelay
// seconds, and checks for stalled jobs every stalledInterval. Measured in the command-budget test.
const IDLE_SETTINGS = { drainDelay: 120, stalledInterval: 120 * 1000 };

const backoffFor = ({ backoffBaseMs, backoffCapMs }) => (attemptsMade) => Math.min(backoffBaseMs * 2 ** Math.max(0, attemptsMade - 1), backoffCapMs);

// Attempts are counted from attemptsStarted, which also counts runs that ended in a rate limit,
// so a provider that keeps asking us to wait still reaches the attempt limit.
const createWorkers = ({ connection, queues, policy = DEFAULT_POLICY, idle = IDLE_SETTINGS, lockDuration }) => {
  const workers = QUEUE_NAMES.map((name) => {
    const settings = policy[name];
    const worker = new Worker(name, async (job) => {
      try {
        return await executeEntry(job.data.entryId, {
          runKey: job.data.runKey,
          attempt: job.attemptsStarted,
          maxAttempts: job.opts.attempts ?? settings.attempts,
        });
      } catch (error) {
        if (!(error instanceof JobError)) throw error;
        if (error.final) throw new UnrecoverableError(error.code);
        if (error.code === 'RATE_LIMITED') {
          // The provider asked everyone to wait: hold the whole queue, and put this job back
          // without spending one of BullMQ's failure retries.
          await queues[name].rateLimit(error.retryAfterMs ?? 60 * 1000);
          throw new RateLimitError();
        }
        throw error;
      }
    }, {
      connection,
      concurrency: settings.concurrency,
      ...(settings.limiter ? { limiter: settings.limiter } : {}),
      drainDelay: idle.drainDelay,
      stalledInterval: idle.stalledInterval,
      ...(lockDuration ? { lockDuration } : {}),
      settings: { backoffStrategy: backoffFor(settings) },
    });
    worker.on('error', (err) => getLogger().warn({ event: 'worker_error', queue: name, err }, 'Queue worker error'));
    return worker;
  });
  return { workers, close: (force = false) => Promise.all(workers.map((worker) => worker.close(force))).then(() => undefined) };
};

module.exports = { IDLE_SETTINGS, backoffFor, createWorkers };
