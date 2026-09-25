const { Queue } = require('bullmq');

// 'ai' joins in the next phase.
const QUEUE_NAMES = ['email'];

// Resend allows 10 requests a second per team; half of that leaves room for anything else sending.
const DEFAULT_POLICY = {
  email: { attempts: 8, backoffBaseMs: 60 * 1000, backoffCapMs: 2 * 60 * 60 * 1000, concurrency: 4, limiter: { max: 5, duration: 1000 } },
};

const createQueues = ({ connection, policy = DEFAULT_POLICY }) => Object.fromEntries(QUEUE_NAMES.map((name) => [name, new Queue(name, {
  connection,
  defaultJobOptions: {
    attempts: policy[name].attempts,
    backoff: { type: 'custom' },
    // The outbox is the record; Redis keeps only what is in flight (Upstash's free tier holds 256 MB).
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  },
})]));

module.exports = { QUEUE_NAMES, DEFAULT_POLICY, createQueues };
