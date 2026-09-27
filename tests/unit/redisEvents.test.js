const { EventEmitter } = require('node:events');
const { captureLogs } = require('../helpers/captureLogs');
const { logErrorsOnce, logReconnects } = require('../../services/jobs/redisEvents');

describe('Redis connection logging', () => {
  let logs;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  it('logs an error shared by several emitters once, naming them all', async () => {
    const ai = new EventEmitter();
    const email = new EventEmitter();
    logErrorsOnce({ ai, email }, 'worker_error', 'Queue worker error');
    const shared = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    ai.emit('error', shared);
    email.emit('error', shared);
    email.emit('error', new Error('own connection'));
    await Promise.resolve();
    expect(logs.lines).toEqual([
      expect.objectContaining({ level: 40, event: 'worker_error', queues: ['ai', 'email'], err: expect.objectContaining({ code: 'ECONNRESET' }), msg: 'Queue worker error' }),
      expect.objectContaining({ event: 'worker_error', queues: ['email'], err: expect.objectContaining({ message: 'own connection' }) }),
    ]);
  });

  it('logs the same error again when it comes back later', async () => {
    const ai = new EventEmitter();
    logErrorsOnce({ ai }, 'queue_error', 'Queue connection error');
    const error = new Error('down');
    ai.emit('error', error);
    await Promise.resolve();
    ai.emit('error', error);
    await Promise.resolve();
    expect(logs.lines.filter((line) => line.event === 'queue_error')).toHaveLength(2);
  });

  it('logs a restored connection only after a reconnect, not on the first connect', () => {
    const client = new EventEmitter();
    logReconnects(client, 'worker');
    client.emit('ready');
    expect(logs.lines).toEqual([]);
    client.emit('reconnecting', 50);
    client.emit('reconnecting', 100);
    client.emit('ready');
    client.emit('ready');
    expect(logs.lines).toEqual([expect.objectContaining({ level: 30, event: 'redis_reconnected', connection: 'worker', msg: 'Redis connection restored' })]);
  });
});
