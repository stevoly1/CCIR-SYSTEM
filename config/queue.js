const IORedis = require('ioredis');

// Settings for background work. REDIS_URL is needed only where the relay and workers run
// (the worker process, or the API with WORKERS_IN_PROCESS=true); the API alone only writes to MongoDB.
// Errors never quote the URL, which can hold a password.
const parseQueueConfig = (env) => {
  let redisUrl = null;
  if (env.REDIS_URL !== undefined && env.REDIS_URL !== '') {
    if (!/^rediss?:\/\/[^/]/.test(env.REDIS_URL)) {
      throw new Error('REDIS_URL must start with redis:// or rediss:// and name a host');
    }
    redisUrl = env.REDIS_URL;
  }
  const inProcess = env.WORKERS_IN_PROCESS ?? 'false';
  if (!['true', 'false'].includes(inProcess)) throw new Error('WORKERS_IN_PROCESS must be true or false');
  const interval = env.RELAY_INTERVAL_MS ?? '1000';
  if (!/^\d+$/.test(interval) || Number(interval) < 250 || Number(interval) > 60000) {
    throw new Error('RELAY_INTERVAL_MS must be an integer from 250 to 60000');
  }
  return { redisUrl, workersInProcess: inProcess === 'true', relayIntervalMs: Number(interval) };
};

const requireRedisUrl = (config) => {
  if (!config.redisUrl) throw new Error('REDIS_URL is required to run background work');
  return config.redisUrl;
};

// ioredis reads rediss:// as TLS, which Upstash requires.
// Producers fail fast, so the relay leaves entries in MongoDB rather than holding them in memory.
const producerConnection = (url) => new IORedis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// Workers wait out an outage: BullMQ requires maxRetriesPerRequest null for its blocking commands.
const workerConnection = (url) => new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: null });

module.exports = { parseQueueConfig, requireRedisUrl, producerConnection, workerConnection };
