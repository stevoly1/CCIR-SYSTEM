const { parseQueueConfig, requireRedisUrl, producerConnection, workerConnection } = require('../../config/queue');
const { createQueues, buildPolicy } = require('./queues');
const { getAiConfig } = require('../../config/ai');
const { createRelay } = require('./relay');
const { createWorkers, IDLE_SETTINGS } = require('./workers');
const { startHeartbeat } = require('./heartbeat');
const { startAiSweep } = require('./aiSweep');
const { getLogger } = require('../../utils/logger');

// The relay, workers, heartbeat and daily classification sweep, for the worker process or API with
// WORKERS_IN_PROCESS=true. stop() finishes the jobs in hand before closing connections.
const startBackgroundWork = async ({ env = process.env, policy = buildPolicy(getAiConfig()), idle = IDLE_SETTINGS, relayIntervalMs, heartbeatMs, sweepIntervalMs } = {}) => {
  const config = parseQueueConfig(env);
  const url = requireRedisUrl(config);
  const producer = producerConnection(url);
  const consumer = workerConnection(url);
  const queues = createQueues({ connection: producer });
  const relay = createRelay({ queues, intervalMs: relayIntervalMs ?? config.relayIntervalMs });
  const workers = createWorkers({ connection: consumer, queues, policy, idle });
  const heartbeat = await startHeartbeat({ intervalMs: heartbeatMs });
  relay.start();
  const sweep = startAiSweep({ intervalMs: sweepIntervalMs });
  getLogger().info({ event: 'background_started', queues: Object.keys(queues) }, 'Background work started');

  let stopping = null;
  const stop = () => {
    stopping ??= (async () => {
      await sweep.stop();
      await relay.stop();
      await workers.close();
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
      await heartbeat.stop();
      producer.disconnect();
      consumer.disconnect();
      getLogger().info({ event: 'background_stopped' }, 'Background work stopped');
    })();
    return stopping;
  };
  return { queues, relay, workers, heartbeat, sweep, stop };
};

module.exports = { startBackgroundWork };
