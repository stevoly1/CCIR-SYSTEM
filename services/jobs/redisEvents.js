const { getLogger } = require('../../utils/logger');

// A dropped Redis connection is reported by every queue or worker sharing it, in the same tick, as
// the same error object: log it once, naming them all. A separate connection (each worker's
// blocking one) drops as its own error and gets its own line.
const logErrorsOnce = (emitters, event, message) => {
  const pending = new Map();
  for (const [name, emitter] of Object.entries(emitters)) {
    emitter.on('error', (err) => {
      if (!pending.has(err)) {
        pending.set(err, []);
        queueMicrotask(() => {
          getLogger().warn({ event, queues: pending.get(err), err }, message);
          pending.delete(err);
        });
      }
      pending.get(err).push(name);
    });
  }
};

// ioredis reconnects by itself after a drop; say so once the connection is usable again.
const logReconnects = (client, connection) => {
  let down = false;
  client.on('reconnecting', () => { down = true; });
  client.on('ready', () => {
    if (down) getLogger().info({ event: 'redis_reconnected', connection }, 'Redis connection restored');
    down = false;
  });
};

module.exports = { logErrorsOnce, logReconnects };
