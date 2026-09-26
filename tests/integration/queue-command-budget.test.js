const IORedis = require('ioredis');
const registry = require('../../services/jobs/registry');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { OutboxEntry } = require('../../models');
const { JobError } = require('../../services/jobs/jobError');
const { DEFAULT_POLICY } = require('../../services/jobs/queues');
const { IDLE_SETTINGS } = require('../../services/jobs/workers');
const { startBackgroundWork } = require('../../services/jobs/background');
const { startRedis } = require('../setup/memoryRedis.cjs');

const MONTH_SECONDS = 30 * 24 * 3600;
// Upstash's free tier: 500,000 commands a month. Idle background work may use at most 300,000,
// leaving the rest for real jobs.
const IDLE_BUDGET = 300000;
// Idle work is measured with the production intervals run ten times faster, then divided by ten.
// Every idle command comes from those intervals; anything on a fixed timer is overcounted, so the
// projection errs high.
const SCALE = 10;
const FAST_IDLE = { drainDelay: IDLE_SETTINGS.drainDelay / SCALE, stalledInterval: IDLE_SETTINGS.stalledInterval / SCALE };
// Three of each cycle, and a little more.
const WINDOW_MS = 3 * FAST_IDLE.stalledInterval + 5000;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// commandstats also counts the commands inside BullMQ's Lua scripts, so this is an upper bound
// on what a per-command plan bills. Our own measuring commands are left out.
const byCommand = (info) => Object.fromEntries(info.split('\n')
  .map((line) => line.match(/^cmdstat_([^:|]+)[^:]*:calls=(\d+)/))
  .filter(Boolean)
  .filter(([, command]) => !['info', 'config'].includes(command))
  .map(([, command, calls]) => [command, Number(calls)]));
const total = (counts) => Object.values(counts).reduce((sum, calls) => sum + calls, 0);

let redis;
beforeAll(async () => {
  registry.registerHandler('test_budget', { queue: 'email', run: async () => {} });
  registry.registerHandler('test_budget_failing', { queue: 'email', run: async () => { throw JobError.of('PROVIDER_DOWN'); } });
  redis = await startRedis();
});
afterAll(() => redis.stop());

describe('Redis command budget', () => {
  it('keeps idle background work, with a retry waiting, within 300,000 commands a month, and reports the cost per job', async () => {
    const admin = new IORedis(redis.url);
    // A long backoff, so the failing job's retry waits through the whole measurement.
    const policy = { email: { ...DEFAULT_POLICY.email, backoffBaseMs: 3600 * 1000, backoffCapMs: 3600 * 1000 } };
    const work = await startBackgroundWork({ env: { REDIS_URL: redis.url }, policy, idle: FAST_IDLE });
    try {
      const failing = await inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_budget_failing', refs: {} }));
      await vi.waitFor(async () => expect(await OutboxEntry.findById(failing._id)).toMatchObject({ state: 'PENDING', attempts: 1 }), { timeout: 10000, interval: 100 });
      await pause(2000);
      expect(await work.queues.email.getJobCounts('waiting', 'active', 'delayed')).toEqual({ waiting: 0, active: 0, delayed: 0 });

      await admin.config('RESETSTAT');
      await pause(WINDOW_MS);
      const idleCounts = byCommand(await admin.info('commandstats'));
      const idle = total(idleCounts);
      const projected = Math.round((idle / (WINDOW_MS / 1000) / SCALE) * MONTH_SECONDS);

      await admin.config('RESETSTAT');
      const JOBS = 20;
      for (let i = 0; i < JOBS; i += 1) {
        await inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_budget', refs: {} }));
      }
      await vi.waitFor(async () => expect(await OutboxEntry.countDocuments({ state: 'DONE' })).toBe(JOBS), { timeout: 30000, interval: 200 });
      const perJob = Math.round(total(byCommand(await admin.info('commandstats'))) / JOBS);

      process.stdout.write(`Redis budget: idle ${idle} commands in ${WINDOW_MS / 1000} s at ${SCALE}x speed, about ${projected} a month at production settings; about ${perJob} commands per job; idle by command ${JSON.stringify(idleCounts)}\n`);
      expect(projected).toBeLessThanOrEqual(IDLE_BUDGET);
      expect(perJob).toBeLessThanOrEqual(60);
    } finally {
      await work.stop();
      admin.disconnect();
    }
  }, 200000);

  it('still picks up a new job at once while a worker long-polls with production settings', async () => {
    const work = await startBackgroundWork({ env: { REDIS_URL: redis.url } });
    try {
      // Long enough for the worker to be blocked in its five-minute poll.
      await pause(3000);
      const started = Date.now();
      const entry = await inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_budget', refs: {} }));
      await vi.waitFor(async () => expect((await OutboxEntry.findById(entry._id)).state).toBe('DONE'), { timeout: 10000, interval: 100 });
      // The relay passes every second; the rest is the worker waking.
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await work.stop();
    }
  }, 30000);
});
