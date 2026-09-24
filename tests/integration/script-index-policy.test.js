const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { withDatabase } = require('../helpers/mongoUri');

// In production, indexes are built only deliberately (npm run db:indexes -- --apply). Scripts that
// load the models must not build them as a side effect of connecting.
const run = (uri, script, ...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../../scripts', script), ...args], {
    // Run from a folder without a .env file, so a developer's own settings are never read.
    cwd: os.tmpdir(),
    env: { ...process.env, MONGO_URL: uri, NODE_ENV: process.env.SCRIPT_POLICY_NODE_ENV || 'production' },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stderr }));
});

describe('scripts on a production database', () => {
  let uri;
  let connection;
  beforeEach(async () => {
    uri = withDatabase(process.env.TEST_MONGO_URI, `ccir-script-indexes-${Date.now()}`);
    connection = await mongoose.createConnection(uri).asPromise();
    await connection.db.collection('users').insertOne({
      name: 'First Admin', email: 'first-admin@example.test', role: 'citizen', isActive: true,
      password: await bcrypt.hash('fixture-password', 4), authProvider: 'local', createdAt: new Date(), updatedAt: new Date(),
    });
  });
  afterEach(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  const builtIndexes = async () => {
    const found = [];
    for (const { name } of await connection.db.listCollections().toArray()) {
      for (const index of await connection.db.collection(name).indexes()) {
        if (index.name !== '_id_') found.push(`${name}.${index.name}`);
      }
    }
    return found;
  };

  it.each([
    ['migratePhase1.js', '--apply', '--backup-reference=test-backup'],
    ['migratePhase1.js', '--verify'],
    ['migratePhase2.js', '--apply', '--backup-reference=test-backup'],
    ['migratePhase2.js', '--verify'],
    ['setUserRole.js', 'first-admin@example.test', 'admin'],
  ])('%s builds no indexes', async (script, ...args) => {
    const result = await run(uri, script, ...args);
    // Exit 2 is a verify reporting failed invariants (here, indexes not yet built), not a crash.
    expect([0, args.includes('--verify') ? 2 : 0], result.stderr).toContain(result.status);
    // The Phase 2 apply creates the category indexes on purpose, once it has found no duplicates.
    const deliberate = script === 'migratePhase2.js' && args.includes('--apply') ? /^categories\./ : null;
    expect((await builtIndexes()).filter((name) => !deliberate?.test(name))).toEqual([]);
  }, 60000);
});
