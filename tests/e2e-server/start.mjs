// Test-only API server for Playwright journeys: in-memory MongoDB replica set,
// seeded accounts, and deterministic provider fakes. Never used by the application.
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

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const replSet = await MongoMemoryReplSet.create({
  binary: { version: require('../setup/mongoVersion.cjs').MONGODB_TEST_VERSION },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
await mongoose.connect(replSet.getUri(), { dbName: 'ccir-e2e' });

require('./fakes.cjs').install();
const app = require('../../app');
await require('./seed.cjs').seed();

const server = app.listen(8181, '127.0.0.1', () => process.stdout.write('e2e API ready on 127.0.0.1:8181\n'));

const shutdown = async () => {
  server.close();
  await mongoose.disconnect();
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
