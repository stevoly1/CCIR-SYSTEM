// Test-only API server for Playwright journeys: in-memory MongoDB replica set, a throwaway Redis
// with the background workers running in this process, seeded accounts, and deterministic provider
// fakes. Never used by the application.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

if (process.env.NODE_ENV !== 'test') {
  process.stderr.write('The e2e server runs only with NODE_ENV=test\n');
  process.exit(1);
}

Object.assign(process.env, {
  JWT_TOKEN: process.env.JWT_TOKEN || 'e2e-access-secret',
  JWT_REFRESH_TOKEN: process.env.JWT_REFRESH_TOKEN || 'e2e-refresh-secret',
  ACCESS_TOKEN_LIFESPAN: '15m',
  REFRESH_TOKEN_LIFESPAN: '7d',
  COOKIE: process.env.COOKIE || 'e2e-cookie-secret',
  BROWSER_ORIGIN: 'http://127.0.0.1:4173',
  ALLOWED_ORIGIN: 'http://127.0.0.1:4173',
  TRUST_PROXY_HOPS: '0',
  AUTH_THROTTLE_HMAC_SECRET: 'e2e-auth-throttle-secret',
});

// Real provider credentials from a developer shell must never reach the journeys: without a
// key the email service is a no-op. Read at module load, so cleared before anything requires it.
delete process.env.RESEND_API_KEY;

// Each run starts with an empty outbox, so a journey never reads a link from an earlier run.
if (process.env.EMAIL_OUTBOX_DIR) {
  const fs = require('node:fs');
  fs.rmSync(process.env.EMAIL_OUTBOX_DIR, { recursive: true, force: true });
  fs.mkdirSync(process.env.EMAIL_OUTBOX_DIR, { recursive: true });
}

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { startRedis } = require('../setup/memoryRedis.cjs');

const redis = await startRedis();
process.env.REDIS_URL = redis.url;

const { startWithPortRetry } = require('../setup/memoryMongo.cjs');
const replSet = await startWithPortRetry(() => new MongoMemoryReplSet({
  binary: { version: require('../setup/mongoVersion.cjs').MONGODB_TEST_VERSION },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
}));
await mongoose.connect(replSet.getUri(), { dbName: 'ccir-e2e' });

require('./fakes.cjs').install();
const app = require('../../app');
await require('./seed.cjs').seed();

// Workers inside this process, with one attempt per job, so a failed email shows at once; a short
// relay interval and long poll keep journeys quick.
const { startBackgroundWork } = require('../../services/jobs/background');
const background = await startBackgroundWork({
  policy: { email: { attempts: 1, backoffBaseMs: 100, backoffCapMs: 100, concurrency: 4, limiter: null } },
  idle: { drainDelay: 1, stalledInterval: 5000 },
  relayIntervalMs: 200,
});

const server = app.listen(8181, '127.0.0.1', () => process.stdout.write('e2e API ready on 127.0.0.1:8181\n'));

const shutdown = async () => {
  await background.stop();
  server.close();
  await mongoose.disconnect();
  await replSet.stop();
  await redis.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
