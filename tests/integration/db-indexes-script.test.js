const path = require('node:path');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
const { withDatabase } = require('../helpers/mongoUri');
const { run } = require('../../scripts/db/indexes');

const script = path.resolve(__dirname, '../../scripts/db/indexes.js');
// Asynchronous, so the in-memory database in this process keeps serving while the script runs.
const runScript = (uri, ...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, MONGO_URL: uri, NODE_ENV: 'production' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stdout, stderr, json: (status === 0 || status === 2) && stdout ? JSON.parse(stdout) : null }));
});

// run() connects the shared mongoose instance itself, as it does from the command line, so the
// test process's own connection (and the index settings run() changes) are restored around it.
const runInProcess = async (uri, options = {}) => {
  let output = '';
  const out = { write: (chunk) => { output += chunk; } };
  const settings = { autoIndex: mongoose.get('autoIndex'), autoCreate: mongoose.get('autoCreate') };
  await mongoose.connection.close();
  try {
    const result = await run({ uri, out, ...options });
    return { ...result, json: JSON.parse(output) };
  } finally {
    mongoose.set('autoIndex', settings.autoIndex);
    mongoose.set('autoCreate', settings.autoCreate);
    await mongoose.connect(process.env.TEST_MONGO_URI, { dbName: 'ccir-integration' });
  }
};

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
    const result = await runInProcess(uri);
    expect(result.complete).toBe(false);
    expect(result.json.applied).toBe(false);
    expect(result.json.missingUnique).toEqual(expect.arrayContaining(['complaints:{"referenceCode":1}', 'users:{"email":1}']));
    expect(result.json.report.Complaint.toCreate).toEqual(expect.arrayContaining([{ createdAt: -1 }, { category: 1 }]));
    expect(await connection.db.listCollections().toArray()).toHaveLength(0);
  });

  it('creates every declared index with --apply and then reports nothing missing', async () => {
    await runInProcess(uri, { apply: true });
    const again = await runInProcess(uri);
    expect(again.complete).toBe(true);
    expect(again.json.missingUnique).toEqual([]);
    for (const entry of Object.values(again.json.report)) expect(entry.toCreate).toEqual([]);
  });

  // Report mode always exits 0; --check turns missing indexes into a failure a deploy can stop on.
  it('exits 2 with --check while any declared index is missing, and 0 once all exist', async () => {
    const before = await runScript(uri, '--check');
    expect(before.status).toBe(2);
    await runScript(uri, '--apply');
    const after = await runScript(uri, '--check');
    expect(after.status).toBe(0);
    expect(after.json.missingUnique).toEqual([]);
  });

  it('seeds the default categories with --apply, once their unique indexes exist', async () => {
    const result = await runInProcess(uri, { apply: true });
    expect(result.json.seeded).toBe(true);
    const names = (await connection.db.collection('categories').find({}).toArray()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Other', 'Pothole']));
    expect(names).toHaveLength(6);
    await runInProcess(uri, { apply: true });
    expect(await connection.db.collection('categories').countDocuments()).toBe(6);
  });

  // A release can make an existing index unique (complaintdeletions.complaintId); MongoDB refuses
  // to create it over the old one, so --apply upgrades it after checking there are no duplicates.
  it('upgrades an existing non-unique index to unique when the values are unique', async () => {
    const deletions = connection.db.collection('complaintdeletions');
    await deletions.insertMany([{ complaintId: new mongoose.Types.ObjectId() }, { complaintId: new mongoose.Types.ObjectId() }]);
    await deletions.createIndex({ complaintId: 1 }, { name: 'complaintId_1' });
    await runInProcess(uri, { apply: true });
    expect((await deletions.indexes()).find((index) => index.name === 'complaintId_1')).toMatchObject({ unique: true });
  });

  it('refuses the upgrade, naming the duplicates, when values repeat', async () => {
    const deletions = connection.db.collection('complaintdeletions');
    const repeated = new mongoose.Types.ObjectId();
    await deletions.insertMany([{ complaintId: repeated }, { complaintId: repeated }]);
    await deletions.createIndex({ complaintId: 1 }, { name: 'complaintId_1' });
    await expect(runInProcess(uri, { apply: true })).rejects.toThrow(/complaintdeletions: .* 1 duplicated value\./);
    expect((await deletions.indexes()).find((index) => index.name === 'complaintId_1').unique).toBeUndefined();
  });

  it('keeps indexes made outside the app unless --drop-extra is given', async () => {
    await runInProcess(uri, { apply: true });
    await connection.db.collection('complaints').createIndex({ description: 1 }, { name: 'console_extra' });
    await runInProcess(uri, { apply: true });
    expect((await connection.db.collection('complaints').indexes()).map((i) => i.name)).toContain('console_extra');
    expect((await runInProcess(uri)).json.report.Complaint.toDrop).toContain('console_extra');
    await runInProcess(uri, { apply: true, dropExtra: true });
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
