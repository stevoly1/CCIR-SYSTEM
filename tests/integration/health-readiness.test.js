const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { testServer } = require('../helpers/testServer');
const { checkReadiness } = require('../../services/readinessService');
const Complaint = require('../../models/Complaint');
const RefreshToken = require('../../models/RefreshToken');
const { MONGODB_TEST_VERSION } = require('../setup/mongoVersion.cjs');
const { startWithPortRetry } = require('../setup/memoryMongo.cjs');

// Distinctive values, so a leak into the response names itself.
const ALL_SERVICES = {
  GOOGLE_API_KEY: 'ready-ai-key-01', CLOUDINARY_CLOUD_NAME: 'ready-cloud-02', CLOUDINARY_API_KEY: 'ready-cloud-key-03',
  CLOUDINARY_API_SECRET: 'ready-cloud-secret-04', RESEND_API_KEY: 'ready-resend-05', EMAIL_FROM: 'CCIR <ready-from-06@example.test>',
  GOOGLE_CLIENT_ID: 'ready-client-07', GOOGLE_CLIENT_SECRET: 'ready-client-secret-08', GOOGLE_CALLBACK_URL: 'http://localhost/ready-callback-09',
};

describe('health endpoints', () => {
  // Readiness is unavailable until every model's indexes exist, as on a real first start.
  beforeAll(async () => {
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  beforeEach(() => Object.entries(ALL_SERVICES).forEach(([key, value]) => vi.stubEnv(key, value)));
  afterEach(() => vi.unstubAllEnvs());

  it('reports ready when the replica set answers and every service is configured', async () => {
    const response = await request(testServer()).get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.database).toEqual({ status: 'ok', serverVersion: MONGODB_TEST_VERSION });
    expect(Object.keys(response.body.checks).sort()).toEqual(['ai', 'database', 'email', 'geocoding', 'googleSignIn', 'uploads']);
  });

  it('reports degraded, naming the services, when optional settings are missing', async () => {
    vi.stubEnv('GOOGLE_API_KEY', '');
    vi.stubEnv('RESEND_API_KEY', '');
    const response = await request(testServer()).get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.ai).toEqual({ status: 'not_configured' });
    expect(response.body.checks.email).toEqual({ status: 'not_configured' });
    expect(response.body.checks.uploads).toEqual({ status: 'ok' });
  });

  it('runs one database check for a burst of readiness requests', async () => {
    const admin = vi.spyOn(mongoose.connection.db, 'admin');
    try {
      const responses = await Promise.all(Array.from({ length: 20 }, () => request(testServer()).get('/api/v1/health/ready')));
      expect(responses.every((response) => response.status === 200)).toBe(true);
      // At most one: a result cached by an earlier test may still be fresh.
      expect(admin.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      admin.mockRestore();
    }
  });

  it('reports unavailable when a required unique index is missing', async () => {
    vi.stubEnv('READINESS_CACHE_MS', '0');
    await Complaint.collection.dropIndex('referenceCode_1');
    try {
      const response = await request(testServer()).get('/api/v1/health/ready');
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unavailable');
      expect(response.body.checks.database).toEqual({ status: 'unavailable', reason: 'INDEXES_MISSING' });
    } finally {
      await Complaint.createIndexes();
    }
  });

  // Without its TTL index, security data (sessions, throttles) silently stops expiring; traffic can
  // still be served, so this is degraded rather than unavailable.
  it('reports degraded, naming the cause, when a TTL index is missing', async () => {
    vi.stubEnv('READINESS_CACHE_MS', '0');
    await RefreshToken.collection.dropIndex('expiresAt_1');
    try {
      const response = await request(testServer()).get('/api/v1/health/ready');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.checks.database).toEqual({ status: 'degraded', reason: 'TTL_INDEXES_MISSING', serverVersion: MONGODB_TEST_VERSION });
    } finally {
      await RefreshToken.createIndexes();
    }
  });

  it('treats a TTL index that no longer expires anything as missing', async () => {
    vi.stubEnv('READINESS_CACHE_MS', '0');
    await RefreshToken.collection.dropIndex('expiresAt_1');
    await RefreshToken.collection.createIndex({ expiresAt: 1 });
    try {
      const response = await request(testServer()).get('/api/v1/health/ready');
      expect(response.body.checks.database.reason).toBe('TTL_INDEXES_MISSING');
    } finally {
      await RefreshToken.collection.dropIndex('expiresAt_1');
      await RefreshToken.createIndexes();
    }
  });

  it('never exposes the connection string or any setting value', async () => {
    const response = await request(testServer()).get('/api/v1/health/ready');
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/mongodb(\+srv)?:\/\//);
    for (const value of Object.values(ALL_SERVICES)) expect(body).not.toContain(value);
  });

  it('keeps live and the legacy alias independent of the database', async () => {
    for (const path of ['/api/v1/health/live', '/api/v1/health']) {
      const response = await request(testServer()).get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    }
    const liveWhileDown = await checkReadiness({ connection: { readyState: 0 } });
    expect(liveWhileDown.httpStatus).toBe(503);
  });
});

describe('checkReadiness database failures', () => {
  it('is unavailable when disconnected', async () => {
    const result = await checkReadiness({ connection: { readyState: 0 } });
    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe('unavailable');
    expect(result.body.checks.database).toEqual({ status: 'unavailable', reason: 'DATABASE_DISCONNECTED' });
  });

  it('is unavailable when ping does not answer in time', async () => {
    const hanging = { readyState: 1, db: { admin: () => ({ command: () => new Promise(() => {}) }) } };
    const started = Date.now();
    const result = await checkReadiness({ connection: hanging, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.body.checks.database).toEqual({ status: 'unavailable', reason: 'DATABASE_TIMEOUT' });
  });

  it('is unavailable, without detail, when the database command fails', async () => {
    const failing = { readyState: 1, db: { admin: () => ({ command: () => Promise.reject(new Error('mongodb://u:p@h auth failed')) }) } };
    const result = await checkReadiness({ connection: failing });
    expect(result.body.checks.database).toEqual({ status: 'unavailable', reason: 'DATABASE_ERROR' });
  });

  it('is unavailable on a standalone server that cannot run transactions', async () => {
    const standalone = await startWithPortRetry(() => MongoMemoryServer.create({ binary: { version: MONGODB_TEST_VERSION } }));
    const connection = await mongoose.createConnection(standalone.getUri()).asPromise();
    try {
      const result = await checkReadiness({ connection });
      expect(result.body.checks.database).toEqual({ status: 'unavailable', reason: 'TRANSACTIONS_UNSUPPORTED' });
    } finally {
      await connection.close();
      await standalone.stop();
    }
  });
});
