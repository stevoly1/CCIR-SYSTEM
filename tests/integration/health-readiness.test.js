const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { testServer } = require('../helpers/testServer');
const { checkReadiness, checkBackground } = require('../../services/readinessService');
const Complaint = require('../../models/Complaint');
const RefreshToken = require('../../models/RefreshToken');
const { OutboxEntry, WorkerHeartbeat } = require('../../models');
const { MONGODB_TEST_VERSION } = require('../setup/mongoVersion.cjs');
const { startWithPortRetry } = require('../setup/memoryMongo.cjs');

// Distinctive values, so a leak into the response names itself.
// A worker that wrote its heartbeat this many seconds ago.
const beat = (secondsAgo) => WorkerHeartbeat.create({ _id: 'w1', host: 'h', pid: 1, startedAt: new Date(), lastSeenAt: new Date(Date.now() - secondsAgo * 1000) });
const waiting = (secondsAgo, state = 'PENDING') => OutboxEntry.collection.insertOne({
  queue: 'email', type: 'report_filed', refs: {}, state, runKey: 0, attempts: 0, createdAt: new Date(Date.now() - secondsAgo * 1000), updatedAt: new Date(),
});

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

  it('reports ready when the replica set answers, a worker is running and every service is configured', async () => {
    vi.stubEnv('READINESS_CACHE_MS', '0');
    await beat(5);
    const response = await request(testServer()).get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.database).toEqual({ status: 'ok', serverVersion: MONGODB_TEST_VERSION });
    expect(response.body.checks.background).toEqual({ status: 'ok', pending: 0, workerLastSeenSeconds: 5, oldestPendingSeconds: null });
    expect(Object.keys(response.body.checks).sort()).toEqual(['ai', 'background', 'database', 'email', 'geocoding', 'googleSignIn', 'uploads']);
  });

  it('reports degraded, still 200, when no worker is running', async () => {
    vi.stubEnv('READINESS_CACHE_MS', '0');
    const response = await request(testServer()).get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.background).toEqual({ status: 'degraded', reason: 'NO_WORKER', pending: 0, workerLastSeenSeconds: null, oldestPendingSeconds: null });
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
    const standalone = await startWithPortRetry(() => new MongoMemoryServer({ binary: { version: MONGODB_TEST_VERSION } }));
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

describe('readiness: background work', () => {
  it('is degraded with no worker, or with one silent for over two minutes', async () => {
    expect(await checkBackground()).toEqual({ status: 'degraded', reason: 'NO_WORKER', pending: 0, workerLastSeenSeconds: null, oldestPendingSeconds: null });
    await beat(121);
    expect(await checkBackground()).toMatchObject({ status: 'degraded', reason: 'WORKER_SILENT', workerLastSeenSeconds: 121 });
  });

  it('reads the newest of several heartbeats', async () => {
    await beat(500);
    await WorkerHeartbeat.create({ _id: 'w2', host: 'h', pid: 2, startedAt: new Date(), lastSeenAt: new Date(Date.now() - 3000) });
    expect(await checkBackground()).toMatchObject({ status: 'ok', workerLastSeenSeconds: 3 });
  });

  it('counts waiting and queued jobs, and is degraded when one has waited over five minutes', async () => {
    await beat(5);
    expect(await checkBackground()).toEqual({ status: 'ok', pending: 0, workerLastSeenSeconds: 5, oldestPendingSeconds: null });
    await waiting(10);
    await waiting(20, 'QUEUED');
    await waiting(900, 'DONE');
    await waiting(900, 'FAILED');
    expect(await checkBackground()).toMatchObject({ status: 'ok', pending: 2, oldestPendingSeconds: 20 });
    await waiting(301, 'QUEUED');
    expect(await checkBackground()).toMatchObject({ status: 'degraded', reason: 'BACKLOG_OLD', pending: 3, oldestPendingSeconds: 301 });
  });

  it('reports a silent worker before an old backlog', async () => {
    await beat(200);
    await waiting(400);
    expect(await checkBackground()).toMatchObject({ status: 'degraded', reason: 'WORKER_SILENT' });
  });

  it('is degraded, without detail, when the check itself fails or hangs', async () => {
    const find = vi.spyOn(WorkerHeartbeat, 'findOne').mockImplementation(() => { throw new Error('mongodb://u:p@h exploded'); });
    try {
      expect(await checkBackground()).toEqual({ status: 'degraded', reason: 'CHECK_FAILED', pending: 0, workerLastSeenSeconds: null, oldestPendingSeconds: null });
    } finally {
      find.mockRestore();
    }
    const count = vi.spyOn(OutboxEntry, 'countDocuments').mockImplementation(() => new Promise(() => {}));
    try {
      const started = Date.now();
      expect(await checkBackground({ timeoutMs: 50 })).toMatchObject({ status: 'degraded', reason: 'CHECK_FAILED' });
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      count.mockRestore();
    }
  });

  it('is not checked when the database is unavailable', async () => {
    const background = vi.fn(async () => ({ status: 'ok' }));
    const result = await checkReadiness({ connection: { readyState: 0 }, background });
    expect(background).not.toHaveBeenCalled();
    expect(result.httpStatus).toBe(503);
    expect(result.body.checks.background).toEqual({ status: 'degraded', reason: 'CHECK_FAILED', pending: 0, workerLastSeenSeconds: null, oldestPendingSeconds: null });
  });
});
