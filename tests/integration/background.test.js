const { OutboxEntry, WorkerHeartbeat } = require('../../models');
const registry = require('../../services/jobs/registry');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { startBackgroundWork } = require('../../services/jobs/background');
const { startRedis } = require('../setup/memoryRedis.cjs');

const FAST = { email: { attempts: 1, backoffBaseMs: 50, backoffCapMs: 50, concurrency: 1, limiter: null } };
let redis;
beforeAll(async () => {
  registry.registerHandler('test_background', { queue: 'email', run: async () => {} });
  redis = await startRedis();
});
afterAll(() => redis.stop());

describe('background work', () => {
  it('needs REDIS_URL', async () => {
    await expect(startBackgroundWork({ env: {} })).rejects.toThrow('REDIS_URL is required to run background work');
  });

  it('relays and runs jobs, beats, and stops cleanly (twice is harmless)', async () => {
    const work = await startBackgroundWork({
      env: { REDIS_URL: redis.url }, policy: FAST, idle: { drainDelay: 1, stalledInterval: 1000 }, relayIntervalMs: 100, heartbeatMs: 200,
    });
    try {
      const entry = await inTransaction((session) => enqueue(session, { queue: 'email', type: 'test_background', refs: {} }));
      await vi.waitFor(async () => expect((await OutboxEntry.findById(entry._id)).state).toBe('DONE'), { timeout: 10000 });
      const beat = await WorkerHeartbeat.findById(work.heartbeat.id);
      expect(beat).toMatchObject({ pid: process.pid });
      const firstSeen = beat.lastSeenAt;
      await vi.waitFor(async () => expect((await WorkerHeartbeat.findById(work.heartbeat.id)).lastSeenAt.getTime()).toBeGreaterThan(firstSeen.getTime()), { timeout: 3000 });
    } finally {
      await work.stop();
      await work.stop();
    }
    expect(await WorkerHeartbeat.findById(work.heartbeat.id)).toBeNull();
  });

  it('declares the heartbeat TTL', () => {
    expect(WorkerHeartbeat.schema.indexes()).toContainEqual([{ lastSeenAt: 1 }, expect.objectContaining({ expireAfterSeconds: 86400 })]);
  });
});
