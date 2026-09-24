// Shared helpers for the database command-line scripts (backup, restore, rehearsal).
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
  }
  return args;
};

const assertRestoreAllowed = ({ targetIsEmpty, drop, confirmDrop }) => {
  if (targetIsEmpty) return;
  if (!drop) throw new Error('The target database is not empty. Pass --drop --confirm-drop to replace its collections.');
  if (!confirmDrop) throw new Error('--drop replaces existing collections; add --confirm-drop to confirm.');
};

const requireTool = (name) => {
  const found = spawnSync('which', [name], { encoding: 'utf8' });
  if (found.status !== 0) {
    throw new Error(`${name} was not found. Install MongoDB Database Tools (macOS: brew tap mongodb/brew && brew install mongodb-database-tools; other systems: https://www.mongodb.com/try/download/database-tools).`);
  }
  return found.stdout.trim();
};

// The connection string can hold a password, so it goes into a private temporary config file
// instead of the command line, where other local users could read it from the process list.
const withToolConfig = async (uri, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-db-'));
  const file = path.join(dir, 'config.yaml');
  fs.writeFileSync(file, `uri: ${JSON.stringify(uri)}\n`, { mode: 0o600 });
  try { return await fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

// Runs a database tool without blocking this process. A blocking spawnSync would stop this
// process from draining the logs of any mongod it owns (the rehearsal's in-memory replica set),
// and that mongod, then the tool, would hang.
const runTool = (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(bin, args);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Every user collection with its document count, a checksum of its documents in _id order
// (canonical Extended JSON, so types are compared exactly), and its index definitions.
const databaseSnapshot = async (uri) => {
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    const { db } = connection;
    const collections = {};
    const names = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
    for (const name of names) {
      const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
      const hash = crypto.createHash('sha256');
      docs.forEach((doc) => hash.update(EJSON.stringify(doc, { relaxed: false })));
      const indexes = (await db.collection(name).indexes())
        .map(({ key, unique = false, sparse = false, expireAfterSeconds }) => ({ key, unique, sparse, expireAfterSeconds }))
        .sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));
      collections[name] = { count: docs.length, sha256: hash.digest('hex'), indexes };
    }
    const { version } = await db.admin().command({ buildInfo: 1 }).catch(() => ({}));
    return { database: db.databaseName, serverVersion: version, collections };
  } finally {
    await connection.close();
  }
};

module.exports = { parseArgs, assertRestoreAllowed, requireTool, withToolConfig, runTool, sha256File, databaseSnapshot };
