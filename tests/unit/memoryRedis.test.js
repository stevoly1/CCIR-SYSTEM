const IORedis = require('ioredis');
const { startRedis } = require('../setup/memoryRedis.cjs');

describe('throwaway Redis for tests', () => {
  it('starts on a free local port with no persistence, answers PING, and stops', async () => {
    const redis = await startRedis();
    const client = new IORedis(redis.url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await client.connect();
      expect(await client.ping()).toBe('PONG');
      expect(await client.config('GET', 'save')).toEqual(['save', '']);
      expect(await client.config('GET', 'appendonly')).toEqual(['appendonly', 'no']);
      expect(await client.config('GET', 'maxmemory-policy')).toEqual(['maxmemory-policy', 'noeviction']);
    } finally {
      client.disconnect();
      await redis.stop();
    }
    const probe = new IORedis(redis.url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    probe.on('error', () => {});
    await expect(probe.connect()).rejects.toThrow();
    probe.disconnect();
  }, 20000);

  it('names the missing program and how to install it', async () => {
    const previous = process.env.REDIS_SERVER_BIN;
    process.env.REDIS_SERVER_BIN = '/nonexistent/redis-server';
    try {
      await expect(startRedis()).rejects.toThrow(/redis-server was not found.*brew install redis.*apt-get install redis-server/s);
    } finally {
      if (previous === undefined) delete process.env.REDIS_SERVER_BIN; else process.env.REDIS_SERVER_BIN = previous;
    }
  });
});
