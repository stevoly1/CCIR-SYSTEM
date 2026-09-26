require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { startBackgroundWork } = require('./services/jobs/background');
const { getLogger } = require('./utils/logger');

const SHUTDOWN_DEADLINE_MS = 30 * 1000;

// The background worker as its own process: `npm run worker`.
// Signal handlers are in place before start-up, so a stop during start-up still waits for it and
// removes the heartbeat.
const main = () => {
  const starting = (async () => {
    await connectDB();
    return startBackgroundWork();
  })();
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    getLogger().info({ signal }, 'Worker stopping');
    setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS).unref();
    const work = await starting.catch(() => null);
    await work?.stop();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  return starting;
};

if (require.main === module) {
  main().catch((error) => {
    getLogger().fatal({ err: error }, 'Worker failed to start');
    process.exit(1);
  });
}

module.exports = { main };
