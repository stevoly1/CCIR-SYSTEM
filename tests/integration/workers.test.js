const { OutboxEntry } = require('../../models');
const registry = require('../../services/jobs/registry');
const { JobError } = require('../../services/jobs/jobError');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { producerConnection, workerConnection } = require('../../config/queue');
const { createQueues } = require('../../services/jobs/queues');
const { createRelay } = require('../../services/jobs/relay');
const { createWorkers, backoffFor } = require('../../services/jobs/workers');
const { startRedis } = require('../setup/memoryRedis.cjs');

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
  queues = createQueues({ connection: producer, policy: FAST });
  relay = createRelay({ queues, intervalMs: 100 });
});
afterEach(async () => {
  await workers?.close();
  consumer?.disconnect();
  workers = null;
  await queues.email.obliterate({ force: true });
  behaviour.run.mockReset();
});
afterAll(async () => {
  await queues.email.close();
  producer.disconnect();
  await redis.stop();
});

const add = () => inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_worker', refs: {} }));
const settle = (entryId, state) => vi.waitFor(async () => expect((await OutboxEntry.findById(entryId)).state).toBe(state), { timeout: 10000, interval: 50 });

describe('workers', () => {
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

  it('gives up on a provider that keeps rate-limiting, after the attempt limit', async () => {
    behaviour.run.mockRejectedValue(JobError.of('RATE_LIMITED', { retryAfterMs: 50 }));
    await setUp();
    const entry = await add();
    await relay.runOnce();
    await settle(entry._id, 'FAILED');
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ attempts: 3, lastErrorCode: 'RATE_LIMITED' });
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
});
