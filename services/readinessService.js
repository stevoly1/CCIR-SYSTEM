const mongoose = require('mongoose');

// Optional services: each is "ok" when all of its settings are present. Values are never read out.
const SERVICE_SETTINGS = {
  ai: ['GOOGLE_API_KEY'],
  uploads: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  email: ['RESEND_API_KEY', 'EMAIL_FROM'],
  googleSignIn: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
};

class ReadinessTimeout extends Error {}

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new ReadinessTimeout()), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// Each entry is "<collection>:<index key as JSON>" for a unique index a model declares but the
// database lacks. A collection that does not exist yet has no indexes at all.
// Declared indexes of one kind (`isKind` reads the declared options or an existing index) that the
// database does not have, as `collection:{"field":1}`.
const missingIndexesOfKind = async (connection, models, isKind) => {
  const missing = [];
  for (const model of Object.values(models)) {
    const wanted = model.schema.indexes().filter(([, options]) => isKind(options ?? {})).map(([fields]) => JSON.stringify(fields));
    if (wanted.length === 0) continue;
    const name = model.collection.collectionName;
    let existing = [];
    try {
      existing = await connection.db.collection(name).indexes();
    } catch (error) {
      if (error.codeName !== 'NamespaceNotFound') throw error;
    }
    const present = new Set(existing.filter(isKind).map((index) => JSON.stringify(index.key)));
    wanted.filter((key) => !present.has(key)).forEach((key) => missing.push(`${name}:${key}`));
  }
  return missing;
};

const missingUniqueIndexes = (connection, models) => missingIndexesOfKind(connection, models, (index) => Boolean(index.unique));
// A TTL index is what expires sessions, throttles and sign-in state; a plain index on the same field is not.
const missingTtlIndexes = (connection, models) => missingIndexesOfKind(connection, models, (index) => typeof index.expireAfterSeconds === 'number');

// Reasons are stable codes only: never an error message, host, or connection string.
const checkDatabase = async ({ connection, models, timeoutMs }) => {
  if (connection.readyState !== 1 || !connection.db) return { status: 'unavailable', reason: 'DATABASE_DISCONNECTED' };
  try {
    const admin = connection.db.admin();
    await withTimeout(admin.command({ ping: 1 }), timeoutMs);
    const hello = await withTimeout(admin.command({ hello: 1 }), timeoutMs);
    // Transactions need a replica set (hosted clusters always are) or a sharded cluster (mongos).
    if (!hello.setName && hello.msg !== 'isdbgrid') return { status: 'unavailable', reason: 'TRANSACTIONS_UNSUPPORTED' };
    if ((await withTimeout(missingUniqueIndexes(connection, models), timeoutMs)).length > 0) {
      return { status: 'unavailable', reason: 'INDEXES_MISSING' };
    }
    const serverVersion = await withTimeout(admin.command({ buildInfo: 1 }), timeoutMs).then((info) => info.version, () => undefined);
    const version = serverVersion ? { serverVersion } : {};
    // Traffic is still safe to serve, but security data would stop expiring: degraded, not unavailable.
    if ((await withTimeout(missingTtlIndexes(connection, models), timeoutMs)).length > 0) {
      return { status: 'degraded', reason: 'TTL_INDEXES_MISSING', ...version };
    }
    return { status: 'ok', ...version };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof ReadinessTimeout ? 'DATABASE_TIMEOUT' : 'DATABASE_ERROR' };
  }
};

const WORKER_SILENT_MS = 2 * 60 * 1000;
const BACKLOG_OLD_MS = 5 * 60 * 1000;
const WAITING = ['PENDING', 'QUEUED'];
const BACKGROUND_UNKNOWN = { status: 'degraded', reason: 'CHECK_FAILED', pending: 0, workerLastSeenSeconds: null, oldestPendingSeconds: null };
const secondsSince = (now, date) => Math.max(0, Math.floor((now - date) / 1000));

// Background work as the database sees it: the newest worker heartbeat and the oldest waiting job.
// Deliberately not a Redis ping: probes arrive every few seconds, and a per-command Redis plan
// would pay for each one. Degraded, never unavailable: the API still serves traffic, and jobs wait.
const checkBackground = async ({ models = mongoose.models, now = new Date(), timeoutMs = 2000 } = {}) => {
  const { OutboxEntry, WorkerHeartbeat } = models;
  try {
    const [beat, oldest, pending] = await withTimeout(Promise.all([
      WorkerHeartbeat.findOne().sort({ lastSeenAt: -1 }).select('lastSeenAt').lean(),
      OutboxEntry.findOne({ state: { $in: WAITING } }).sort({ createdAt: 1 }).select('createdAt').lean(),
      OutboxEntry.countDocuments({ state: { $in: WAITING } }),
    ]), timeoutMs);
    const facts = {
      pending,
      workerLastSeenSeconds: beat ? secondsSince(now, beat.lastSeenAt) : null,
      oldestPendingSeconds: oldest ? secondsSince(now, oldest.createdAt) : null,
    };
    if (!beat) return { status: 'degraded', reason: 'NO_WORKER', ...facts };
    if (now - beat.lastSeenAt > WORKER_SILENT_MS) return { status: 'degraded', reason: 'WORKER_SILENT', ...facts };
    if (oldest && now - oldest.createdAt > BACKLOG_OLD_MS) return { status: 'degraded', reason: 'BACKLOG_OLD', ...facts };
    return { status: 'ok', ...facts };
  } catch {
    return BACKGROUND_UNKNOWN;
  }
};

// /health/ready is public and never rate limited (a probe must not be locked out), so each check
// behind it (database, background work) is shared: concurrent calls wait for one check, and its
// result, unavailable included, is reused for READINESS_CACHE_MS (default 1000; 0 checks on every call).
const DEFAULT_CACHE_MS = 1000;
const cacheMsFrom = (env) => {
  const value = Number(env.READINESS_CACHE_MS ?? DEFAULT_CACHE_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CACHE_MS;
};
const createCachedProbe = ({ check = () => checkDatabase({ connection: mongoose.connection, models: mongoose.models, timeoutMs: 2000 }), env = process.env, now = Date.now } = {}) => {
  let last = null;
  let inFlight = null;
  return () => {
    if (last && now() - last.at < cacheMsFrom(env)) return Promise.resolve(last.result);
    if (!inFlight) {
      inFlight = check()
        .then((result) => { last = { at: now(), result }; return result; })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  };
};
const createDatabaseProbe = createCachedProbe;

const checkReadiness = async ({
  connection = mongoose.connection, models = mongoose.models, env = process.env, timeoutMs = 2000,
  database = () => checkDatabase({ connection, models, timeoutMs }),
  background = () => checkBackground({ models, timeoutMs }),
} = {}) => {
  const checks = { database: await database() };
  // With the database down, background work cannot be read either; the answer is already 503.
  checks.background = checks.database.status === 'unavailable' ? BACKGROUND_UNKNOWN : await background();
  for (const [service, names] of Object.entries(SERVICE_SETTINGS)) {
    checks[service] = names.every((name) => Boolean(env[name])) ? { status: 'ok' } : { status: 'not_configured' };
  }
  // Photon is a keyless public service; there is no setting to check.
  checks.geocoding = { status: 'ok' };

  if (checks.database.status === 'unavailable') return { httpStatus: 503, body: { status: 'unavailable', checks } };
  const degraded = Object.values(checks).some((check) => check.status === 'not_configured' || check.status === 'degraded');
  return { httpStatus: 200, body: { status: degraded ? 'degraded' : 'ready', checks } };
};

module.exports = { checkReadiness, checkBackground, createCachedProbe, createDatabaseProbe, missingUniqueIndexes, missingTtlIndexes };
