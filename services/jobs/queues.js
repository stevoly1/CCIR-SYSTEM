const { Queue } = require('bullmq');
const { parseAiConfig } = require('../../config/ai');

const QUEUE_NAMES = ['ai', 'email'];

// attempts and the backoff are applied through the outbox, not by BullMQ.
// The ai queue keeps a slow provider from delaying email, and its rate follows AI_RATE_PER_MINUTE.
// Resend allows 10 requests a second per team; half of that leaves room for anything else sending.
const buildPolicy = (aiConfig) => ({
  ai: { attempts: 6, backoffBaseMs: 30 * 1000, backoffCapMs: 30 * 60 * 1000, concurrency: 2, limiter: { max: aiConfig.ratePerMinute, duration: 60 * 1000 } },
  email: { attempts: 8, backoffBaseMs: 60 * 1000, backoffCapMs: 2 * 60 * 60 * 1000, concurrency: 4, limiter: { max: 5, duration: 1000 } },
});
const DEFAULT_POLICY = buildPolicy(parseAiConfig({}));

// Each BullMQ job is one attempt: retries are scheduled in MongoDB (see execute.js), so no job ever
// waits in Redis's delayed set. A job that crashes is removed, so the relay's re-offer can bring
// its entry back.
const createQueues = ({ connection }) => Object.fromEntries(QUEUE_NAMES.map((name) => [name, new Queue(name, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    // The outbox is the record; Redis keeps only what is in flight (Upstash's free tier holds 256 MB).
    removeOnComplete: true,
    removeOnFail: true,
  },
})]));

module.exports = { QUEUE_NAMES, DEFAULT_POLICY, buildPolicy, createQueues };
