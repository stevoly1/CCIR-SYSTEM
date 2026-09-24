const path = require('node:path');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
const { withDatabase } = require('../helpers/mongoUri');

const script = path.resolve(__dirname, '../../scripts/db/indexes.js');
// Asynchronous, so the in-memory database in this process keeps serving while the script runs.
const runScript = (uri, ...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, MONGO_URL: uri, NODE_ENV: 'production' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stdout, stderr, json: status === 0 && stdout ? JSON.parse(stdout) : null }));
});

describe('npm run db:indexes', () => {
  let uri;
  let connection;
  beforeEach(async () => {
    uri = withDatabase(process.env.TEST_MONGO_URI, `ccir-indexes-${Date.now()}`);
    connection = await mongoose.createConnection(uri).asPromise();
  });
  afterEach(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  it('reports missing indexes and creates nothing without --apply', async () => {
    const result = await runScript(uri);
    expect(result.status).toBe(0);
    expect(result.json.applied).toBe(false);
    expect(result.json.missingUnique).toEqual(expect.arrayContaining(['complaints:{"referenceCode":1}', 'users:{"email":1}']));
    expect(result.json.report.Complaint.toCreate).toEqual(expect.arrayContaining([{ createdAt: -1 }, { category: 1 }]));
    expect(await connection.db.listCollections().toArray()).toHaveLength(0);
  });

  it('creates every declared index with --apply and then reports nothing missing', async () => {
    expect((await runScript(uri, '--apply')).status).toBe(0);
    const again = await runScript(uri);
    expect(again.json.missingUnique).toEqual([]);
    for (const entry of Object.values(again.json.report)) expect(entry.toCreate).toEqual([]);
  });

  it('seeds the default categories with --apply, once their unique indexes exist', async () => {
    const result = await runScript(uri, '--apply');
    expect(result.json.seeded).toBe(true);
    const names = (await connection.db.collection('categories').find({}).toArray()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Other', 'Pothole']));
    expect(names).toHaveLength(6);
    await runScript(uri, '--apply');
    expect(await connection.db.collection('categories').countDocuments()).toBe(6);
  });

  it('keeps indexes made outside the app unless --drop-extra is given', async () => {
    await runScript(uri, '--apply');
    await connection.db.collection('complaints').createIndex({ description: 1 }, { name: 'console_extra' });
    await runScript(uri, '--apply');
    expect((await connection.db.collection('complaints').indexes()).map((i) => i.name)).toContain('console_extra');
    expect((await runScript(uri)).json.report.Complaint.toDrop).toContain('console_extra');
    await runScript(uri, '--apply', '--drop-extra');
    expect((await connection.db.collection('complaints').indexes()).map((i) => i.name)).not.toContain('console_extra');
  });

  it('refuses --drop-extra without --apply, and unknown options, without printing the connection string', async () => {
    for (const args of [['--drop-extra'], ['--aply']]) {
      const result = await runScript(uri, ...args);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).not.toContain(uri);
    }
    expect(await connection.db.listCollections().toArray()).toHaveLength(0);
  });

  it('fails cleanly on an unreachable database without printing its credentials', async () => {
    const unreachable = 'mongodb://ccir-app:Unreachable-Pass-77@127.0.0.1:9/ccir?serverSelectionTimeoutMS=300&directConnection=true';
    const result = await runScript(unreachable);
    expect(result.status).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stdout + result.stderr).not.toContain('Unreachable-Pass-77');
  });

  it('builds no index when the application itself connects in production', async () => {
    // The real start-up path: models load first, then connectDB() connects.
    const startup = [
      "require('./models');",
      "const mongoose = require('mongoose');",
      "require('./config/db')().then(async () => {",
      "  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));",
      "  await mongoose.disconnect();",
      "});",
    ].join('\n');
    const status = await new Promise((resolve) => {
      spawn(process.execPath, ['-e', startup], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, MONGO_URL: uri, NODE_ENV: 'production', LOG_LEVEL: 'silent' },
      }).on('close', resolve);
    });
    expect(status).toBe(0);
    const result = await runScript(uri);
    expect(result.json.missingUnique.length).toBeGreaterThan(0);
    for (const { name } of await connection.db.listCollections().toArray()) {
      const names = (await connection.db.collection(name).indexes()).map((index) => index.name);
      expect(names.filter((indexName) => indexName !== '_id_'), name).toEqual([]);
    }
  });
});
