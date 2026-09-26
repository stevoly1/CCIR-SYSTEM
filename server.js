require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const seedDefaultCategories = require('./utils/seedCategories');
const { parseQueueConfig, requireRedisUrl } = require('./config/queue');
const { startBackgroundWork } = require('./services/jobs/background');
const { getLogger } = require('./utils/logger');

const port = process.env.PORT || 8080;
const SHUTDOWN_DEADLINE_MS = 30 * 1000;

const startApp = async () => {
  let server = null;
  try {
    // Queue settings are checked before anything starts, so a bad value never leaves a half-started app.
    const queueConfig = parseQueueConfig(process.env);
    if (queueConfig.workersInProcess) requireRedisUrl(queueConfig);
    await connectDB();
    const seeding = await seedDefaultCategories({ requireUniqueIndexes: process.env.NODE_ENV === 'production' });
    if (!seeding.seeded) {
      getLogger().warn({ reason: seeding.reason }, 'Default categories not seeded; run npm run db:indexes -- --apply');
    }

    server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, resolve);
    });
    getLogger().info({ port: server.address().port }, 'App is listening');

    // Signal handlers are in place before background work starts, so a stop during start-up
    // still waits for it and removes the heartbeat.
    const starting = queueConfig.workersInProcess ? startBackgroundWork() : Promise.resolve(null);
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      getLogger().info({ signal }, 'App stopping');
      setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS).unref();
      await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections?.(); });
      const background = await starting.catch(() => null);
      await background?.stop();
      await mongoose.disconnect();
      process.exit(0);
    };
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
    await starting;
    return server;
  } catch (error) {
    getLogger().fatal({ err: error }, 'Failed to start app');
    process.exitCode = 1;
    server?.close();
    await mongoose.disconnect().catch(() => {});
    return null;
  }
};

if (require.main === module) {
  startApp();
}

module.exports = startApp;
