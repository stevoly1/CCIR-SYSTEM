const { Queue } = require('bullmq');
const { OutboxEntry } = require('../../models');
const registry = require('../../services/jobs/registry');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { producerConnection } = require('../../config/queue');
const { createQueues, DEFAULT_POLICY } = require('../../services/jobs/queues');
const { createRelay } = require('../../services/jobs/relay');
const { jobIdFor } = require('../../services/jobs/jobId');
const { startRedis } = require('../setup/memoryRedis.cjs');
const { captureLogs } = require('../helpers/captureLogs');

let redis;
let connection;
let queues;
beforeAll(async () => {
  registry.registerHandler('test_relay', { queue: 'email', run: async () => {} });
  redis = await startRedis();
  connection = producerConnection(redis.url);
  queues = createQueues({ connection, policy: DEFAULT_POLICY });
});
afterAll(async () => {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  connection.disconnect();
  await redis.stop();
});
beforeEach(() => queues.email.obliterate({ force: true }));

const add = () => inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_relay', refs: {} }));

describe('relay', () => {
  it('moves pending entries into their queue, oldest first, with the entry id as job id', async () => {
    const first = await add();
    const second = await add();
    const relay = createRelay({ queues, intervalMs: 1000 });
    expect(await relay.runOnce()).toBe(2);
    const jobs = await queues.email.getJobs(['waiting'], 0, 10, true);
    expect(jobs.map((job) => job.id)).toEqual([jobIdFor(first), jobIdFor(second)]);
    expect(jobs[0].data).toEqual({ entryId: String(first._id), runKey: 0 });
    expect(jobs[0].opts).toMatchObject({ attempts: 8, removeOnComplete: true });
    expect((await OutboxEntry.find().sort({ createdAt: 1 })).map((entry) => entry.state)).toEqual(['QUEUED', 'QUEUED']);
    expect(jobIdFor(first)).not.toContain(':');
  });

  it('adds nothing twice when an entry is relayed again', async () => {
    const entry = await add();
    const relay = createRelay({ queues, intervalMs: 1000 });
    await relay.runOnce();
    await OutboxEntry.updateOne({ _id: entry._id }, { state: 'PENDING' });
    await relay.runOnce();
    expect(await queues.email.getJobCounts('waiting')).toEqual({ waiting: 1 });
  });

  it('re-offers long-queued entries, so a job Redis lost runs again, and nothing twice', async () => {
    const lost = await add();
    const kept = await add();
    const relay = createRelay({ queues, intervalMs: 1000 });
    await relay.runOnce();
    await (await queues.email.getJob(jobIdFor(lost))).remove();
    const longAgo = new Date(Date.now() - 11 * 60 * 1000);
    await OutboxEntry.updateMany({}, { queuedAt: longAgo });
    expect(await relay.reofferOnce()).toBe(2);
    const ids = (await queues.email.getJobs(['waiting'], 0, 10, true)).map((job) => job.id).sort();
    expect(ids).toEqual([jobIdFor(lost), jobIdFor(kept)].sort());
    expect((await OutboxEntry.findById(lost._id)).queuedAt.getTime()).toBeGreaterThan(longAgo.getTime());
    // Entries queued recently are left alone.
    expect(await relay.reofferOnce()).toBe(0);
  });

  it('leaves entries in MongoDB while Redis is down, says so once, and catches up', async () => {
    const downRedis = await startRedis();
    const downConnection = producerConnection(downRedis.url);
    downConnection.on('error', () => {});
    const downQueues = { email: new Queue('email', { connection: downConnection }) };
    downQueues.email.on('error', () => {});
    await downRedis.stop();
    await add();
    const relay = createRelay({ queues: downQueues, intervalMs: 1000 });
    const logs = captureLogs();
    try {
      await relay.runOnce();
      await relay.runOnce();
    } finally {
      logs.restore();
    }
    expect(logs.lines.filter((line) => line.event === 'relay_unavailable')).toHaveLength(1);
    expect(await OutboxEntry.find({ state: 'PENDING' })).toHaveLength(1);
    await downQueues.email.close().catch(() => {});
    downConnection.disconnect();

    expect(await createRelay({ queues, intervalMs: 1000 }).runOnce()).toBe(1);
    expect(await OutboxEntry.find({ state: 'QUEUED' })).toHaveLength(1);
  });

  it('runs on its interval until stopped', async () => {
    const relay = createRelay({ queues, intervalMs: 250 });
    relay.start();
    await add();
    await vi.waitFor(async () => expect(await OutboxEntry.countDocuments({ state: 'QUEUED' })).toBe(1), { timeout: 5000 });
    await relay.stop();
  });
});
