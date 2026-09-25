const { parseQueueConfig, requireRedisUrl, producerConnection, workerConnection } = require('../../config/queue');

describe('queue settings', () => {
  it('has safe defaults', () => {
    expect(parseQueueConfig({})).toEqual({ redisUrl: null, workersInProcess: false, relayIntervalMs: 1000 });
  });

  it('reads valid values', () => {
    expect(parseQueueConfig({ REDIS_URL: 'rediss://default:x@example.test:6379', WORKERS_IN_PROCESS: 'true', RELAY_INTERVAL_MS: '250' }))
      .toEqual({ redisUrl: 'rediss://default:x@example.test:6379', workersInProcess: true, relayIntervalMs: 250 });
    expect(parseQueueConfig({ WORKERS_IN_PROCESS: 'false' }).workersInProcess).toBe(false);
    expect(parseQueueConfig({ REDIS_URL: '' }).redisUrl).toBeNull();
  });

  it.each([
    [{ REDIS_URL: 'http://example.test' }, /REDIS_URL must start with redis:\/\/ or rediss:\/\//],
    [{ REDIS_URL: 'redis://' }, /REDIS_URL/],
    [{ WORKERS_IN_PROCESS: 'yes' }, /WORKERS_IN_PROCESS must be true or false/],
    [{ RELAY_INTERVAL_MS: '100' }, /RELAY_INTERVAL_MS must be an integer from 250 to 60000/],
    [{ RELAY_INTERVAL_MS: '60001' }, /RELAY_INTERVAL_MS/],
    [{ RELAY_INTERVAL_MS: '1.5' }, /RELAY_INTERVAL_MS/],
  ])('refuses %j', (env, message) => {
    expect(() => parseQueueConfig(env)).toThrow(message);
  });

  it('never puts the URL, which can hold a password, in an error message', () => {
    expect(() => parseQueueConfig({ REDIS_URL: 'http://user:secret-pass@example.test' }))
      .toThrow(expect.objectContaining({ message: expect.not.stringContaining('secret-pass') }));
  });

  it('needs REDIS_URL only to run background work', () => {
    expect(() => requireRedisUrl(parseQueueConfig({}))).toThrow('REDIS_URL is required to run background work');
    expect(requireRedisUrl(parseQueueConfig({ REDIS_URL: 'redis://127.0.0.1:6379' }))).toBe('redis://127.0.0.1:6379');
  });

  it('gives producers a fail-fast connection and workers a patient one, TLS for rediss://', () => {
    const producer = producerConnection('redis://127.0.0.1:1');
    const worker = workerConnection('rediss://127.0.0.1:1');
    try {
      expect(producer.options).toMatchObject({ enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });
      expect(producer.options.tls).toBeUndefined();
      expect(worker.options).toMatchObject({ maxRetriesPerRequest: null, lazyConnect: true });
      expect(worker.options.tls).toBeDefined();
    } finally {
      producer.disconnect();
      worker.disconnect();
    }
  });
});
