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
const missingUniqueIndexes = async (connection, models) => {
  const missing = [];
  for (const model of Object.values(models)) {
    const wanted = model.schema.indexes().filter(([, options]) => options?.unique).map(([fields]) => JSON.stringify(fields));
    if (wanted.length === 0) continue;
    const name = model.collection.collectionName;
    let existing = [];
    try {
      existing = await connection.db.collection(name).indexes();
    } catch (error) {
      if (error.codeName !== 'NamespaceNotFound') throw error;
    }
    const present = new Set(existing.filter((index) => index.unique).map((index) => JSON.stringify(index.key)));
    wanted.filter((key) => !present.has(key)).forEach((key) => missing.push(`${name}:${key}`));
  }
  return missing;
};

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
    return { status: 'ok', ...(serverVersion ? { serverVersion } : {}) };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof ReadinessTimeout ? 'DATABASE_TIMEOUT' : 'DATABASE_ERROR' };
  }
};

// /health/ready is public and never rate limited (a probe must not be locked out), so the database
// check behind it is shared: concurrent calls wait for one check, and its result, unavailable
// included, is reused for READINESS_CACHE_MS (default 1000; 0 checks on every call).
const DEFAULT_CACHE_MS = 1000;
const cacheMsFrom = (env) => {
  const value = Number(env.READINESS_CACHE_MS ?? DEFAULT_CACHE_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CACHE_MS;
};
const createDatabaseProbe = ({ check = () => checkDatabase({ connection: mongoose.connection, models: mongoose.models, timeoutMs: 2000 }), env = process.env, now = Date.now } = {}) => {
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

const checkReadiness = async ({
  connection = mongoose.connection, models = mongoose.models, env = process.env, timeoutMs = 2000,
  database = () => checkDatabase({ connection, models, timeoutMs }),
} = {}) => {
  const checks = { database: await database() };
  for (const [service, names] of Object.entries(SERVICE_SETTINGS)) {
    checks[service] = names.every((name) => Boolean(env[name])) ? { status: 'ok' } : { status: 'not_configured' };
  }
  // Photon is a keyless public service; there is no setting to check.
  checks.geocoding = { status: 'ok' };

  if (checks.database.status !== 'ok') return { httpStatus: 503, body: { status: 'unavailable', checks } };
  const degraded = Object.values(checks).some((check) => check.status === 'not_configured');
  return { httpStatus: 200, body: { status: degraded ? 'degraded' : 'ready', checks } };
};

module.exports = { checkReadiness, createDatabaseProbe, missingUniqueIndexes };
