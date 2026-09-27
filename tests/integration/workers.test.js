const { OutboxEntry } = require('../../models');
const registry = require('../../services/jobs/registry');
const { JobError } = require('../../services/jobs/jobError');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { producerConnection, workerConnection } = require('../../config/queue');
const { createQueues, buildPolicy, QUEUE_NAMES } = require('../../services/jobs/queues');
const { createRelay } = require('../../services/jobs/relay');
const { createWorkers, backoffFor } = require('../../services/jobs/workers');
const { startRedis } = require('../setup/memoryRedis.cjs');
const { captureLogs } = require('../helpers/captureLogs');

// Fast settings: the same code with short waits.
const FAST = { email: { attempts: 3, backoffBaseMs: 50, backoffCapMs: 200, concurrency: 2, limiter: null } };
const behaviour = { run: vi.fn() };

let redis; let producer; let consumer; let queues; let relay; let workers;
const setUp = async (extra = {}) => {
  consumer = workerConnection(redis.url);
  workers = createWorkers({ connection: consumer, queues, policy: FAST, idle: { drainDelay: 1, stalledInterval: 1000 }, ...extra });
};
beforeAll(async () => {
  registry.registerHandler('test_worker', { queue: 'email', run: (...args) => behaviour.run(...args) });
  redis = await startRedis();
  producer = producerConnection(redis.url);
  queues = createQueues({ connection: producer });
  // Retries come back through the relay, as in production.
  relay = createRelay({ queues, intervalMs: 100 });
  relay.start();
});
afterEach(async () => {
  await workers?.close();
  consumer?.disconnect();
  workers = null;
  await Promise.all(Object.values(queues).map((queue) => queue.obliterate({ force: true })));
  behaviour.run.mockReset();
});
afterAll(async () => {
  await relay.stop();
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  producer.disconnect();
  await redis.stop();
});

const add = () => inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_worker', refs: {} }));
const settle = (entryId, state) => vi.waitFor(async () => expect((await OutboxEntry.findById(entryId)).state).toBe(state), { timeout: 10000, interval: 50 });

describe('workers', () => {
  it('sets an independent ai queue with its own attempt, backoff, concurrency and rate limits', () => {
    expect(buildPolicy({ ratePerMinute: 12 }).ai).toEqual({
      attempts: 6, backoffBaseMs: 30000, backoffCapMs: 30 * 60 * 1000,
      concurrency: 2, limiter: { max: 12, duration: 60000 },
    });
    expect(QUEUE_NAMES).toEqual(['ai', 'email']);
  });

  it('runs ai jobs on their own queue, so a slow classification never holds up an email', async () => {
    let release;
    registry.registerHandler('test_slow_ai', { queue: 'ai', run: () => new Promise((resolve) => { release = resolve; }) });
    registry.registerHandler('test_quick_email', { queue: 'email', run: async () => {} });
    await setUp();
    try {
      const slow = await inTransaction((session) => enqueue(session, { queue: 'ai', type: 'test_slow_ai', refs: {} }));
      const quick = await inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_quick_email', refs: {} }));
      await relay.runOnce();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'), { timeout: 10000, interval: 50 });
      await settle(quick._id, 'DONE');
      expect((await OutboxEntry.findById(slow._id)).state).not.toBe('DONE');
      release();
      await settle(slow._id, 'DONE');
    } finally {
      release?.();
    }
  });

  it('backs off exponentially, up to the cap', () => {
    const delay = backoffFor({ backoffBaseMs: 60000, backoffCapMs: 7200000 });
    expect([1, 2, 3, 4, 8].map((n) => delay(n))).toEqual([60000, 120000, 240000, 480000, 7200000]);
  });

  it('runs a queued entry once', async () => {
    behaviour.run.mockResolvedValue(undefined);
    await setUp();
    const entry = await add();
    await relay.runOnce();
    await settle(entry._id, 'DONE');
    expect(behaviour.run).toHaveBeenCalledTimes(1);
  });

  it('retries a passing failure, then succeeds', async () => {
    behaviour.run.mockRejectedValueOnce(JobError.of('PROVIDER_DOWN')).mockResolvedValue(undefined);
    await setUp();
    const entry = await add();
    await relay.runOnce();
    await settle(entry._id, 'DONE');
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ attempts: 2 });
  });

  it('keeps a waiting retry out of Redis entirely', async () => {
    behaviour.run.mockRejectedValue(JobError.of('PROVIDER_DOWN'));
    await setUp({ policy: { email: { ...FAST.email, backoffBaseMs: 60000, backoffCapMs: 60000 } } });
    const entry = await add();
    await relay.runOnce();
    await vi.waitFor(async () => expect((await OutboxEntry.findById(entry._id)).attempts).toBe(1), { timeout: 5000, interval: 20 });
    expect((await OutboxEntry.findById(entry._id)).notBefore.getTime()).toBeGreaterThan(Date.now() + 50000);
    await vi.waitFor(async () => expect(await queues.email.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'))
      .toEqual({ waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 }), { timeout: 5000, interval: 20 });
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ state: 'PENDING', attempts: 1 });
  });

  it('stops at the last attempt, and at once when retrying cannot help', async () => {
    behaviour.run.mockRejectedValue(JobError.of('PROVIDER_DOWN'));
    await setUp();
    const exhausted = await add();
    await relay.runOnce();
    await settle(exhausted._id, 'FAILED');
    expect(await OutboxEntry.findById(exhausted._id)).toMatchObject({ attempts: 3, lastErrorCode: 'PROVIDER_DOWN' });
    expect(behaviour.run).toHaveBeenCalledTimes(3);

    behaviour.run.mockReset().mockRejectedValue(JobError.of('REJECTED'));
    const rejected = await add();
    await relay.runOnce();
    await settle(rejected._id, 'FAILED');
    expect(behaviour.run).toHaveBeenCalledTimes(1);
  });

  it('pauses the whole queue for a rate limit, then carries on', async () => {
    behaviour.run.mockRejectedValueOnce(JobError.of('RATE_LIMITED', { retryAfterMs: 1500 })).mockResolvedValue(undefined);
    await setUp();
    const first = await add();
    await relay.runOnce();
    await vi.waitFor(async () => expect((await OutboxEntry.findById(first._id)).lastErrorCode).toBe('RATE_LIMITED'), { timeout: 5000, interval: 20 });
    const limitedAt = Date.now();
    const second = await add();
    await relay.runOnce();
    await settle(second._id, 'DONE');
    expect(Date.now() - limitedAt).toBeGreaterThanOrEqual(1000);
    await settle(first._id, 'DONE');
  });

  it('holds the queue before the rate-limited failure is recorded, so nothing slips through in between', async () => {
    behaviour.run.mockRejectedValueOnce(JobError.of('RATE_LIMITED', { retryAfterMs: 5000 })).mockResolvedValue(undefined);
    await setUp();
    const updateOne = OutboxEntry.updateOne.bind(OutboxEntry);
    let pauseWhenRecorded;
    const spy = vi.spyOn(OutboxEntry, 'updateOne').mockImplementation(async (filter, update, ...rest) => {
      if (update?.$set?.lastErrorCode === 'RATE_LIMITED') pauseWhenRecorded = await queues.email.getRateLimitTtl(1);
      return updateOne(filter, update, ...rest);
    });
    try {
      const entry = await add();
      await relay.runOnce();
      await vi.waitFor(() => expect(pauseWhenRecorded).toBeDefined(), { timeout: 5000, interval: 20 });
      expect(pauseWhenRecorded).toBeGreaterThan(4000);
      expect((await OutboxEntry.findById(entry._id)).lastErrorCode).toBe('RATE_LIMITED');
    } finally {
      spy.mockRestore();
      await queues.email.removeRateLimitKey();
    }
  });

  it('gives up on a provider that keeps rate-limiting, after the attempt limit', async () => {
    behaviour.run.mockRejectedValue(JobError.of('RATE_LIMITED', { retryAfterMs: 50 }));
    await setUp();
    const entry = await add();
    await relay.runOnce();
    await settle(entry._id, 'FAILED');
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ attempts: 3, lastErrorCode: 'RATE_LIMITED' });
  });

  it('removes and logs a job whose outcome cannot be recorded, leaving the entry for the re-offer', async () => {
    behaviour.run.mockResolvedValue(undefined);
    await setUp();
    const find = vi.spyOn(OutboxEntry, 'findById').mockRejectedValueOnce(new Error('database gone'));
    const logs = captureLogs();
    try {
      const entry = await add();
      await relay.runOnce();
      await vi.waitFor(() => expect(logs.lines).toContainEqual(expect.objectContaining({ event: 'job_crashed', queue: 'email', entryId: String(entry._id) })), { timeout: 5000, interval: 20 });
      await vi.waitFor(async () => expect(await queues.email.getJobCounts('failed', 'waiting', 'active')).toEqual({ failed: 0, waiting: 0, active: 0 }), { timeout: 5000, interval: 20 });
      expect((await OutboxEntry.findById(entry._id)).state).toBe('QUEUED');
      expect(behaviour.run).not.toHaveBeenCalled();
    } finally {
      logs.restore();
      find.mockRestore();
    }
  });

  it('runs a job again when its worker disappears mid-job', async () => {
    let release;
    behaviour.run.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    await setUp({ lockDuration: 1000 });
    const entry = await add();
    await relay.runOnce();
    await vi.waitFor(() => expect(behaviour.run).toHaveBeenCalledTimes(1), { timeout: 5000 });
    await workers.close(true); // force: the lock is not released, as when a process dies
    consumer.disconnect();
    await setUp({ lockDuration: 1000 });
    await settle(entry._id, 'DONE');
    release();
    expect(behaviour.run).toHaveBeenCalledTimes(2);
  });

  // A reset reaches every worker (or queue) sharing the connection: one line, and work carries on.
  it('logs a dropped connection once per connection and keeps working after the reconnect', async () => {
    behaviour.run.mockResolvedValue(undefined);
    await setUp();
    await Promise.all(workers.workers.map((worker) => worker.waitUntilReady()));
    const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const logs = captureLogs();
    try {
      consumer.stream.destroy(reset());
      producer.stream.destroy(reset());
      await vi.waitFor(() => expect(logs.lines.filter((line) => line.event === 'queue_error')).toHaveLength(1), { timeout: 5000, interval: 20 });
      const workerErrors = logs.lines.filter((line) => line.event === 'worker_error');
      expect(workerErrors).toHaveLength(1);
      expect(workerErrors[0]).toMatchObject({ level: 40, queues: ['ai', 'email'], err: { code: 'ECONNRESET' } });
      expect(logs.lines.find((line) => line.event === 'queue_error')).toMatchObject({ queues: ['ai', 'email'], err: { code: 'ECONNRESET' } });
      await vi.waitFor(() => expect([consumer.status, producer.status]).toEqual(['ready', 'ready']), { timeout: 5000, interval: 20 });
      const entry = await add();
      await relay.runOnce();
      await settle(entry._id, 'DONE');
    } finally {
      logs.restore();
    }
  });
});
