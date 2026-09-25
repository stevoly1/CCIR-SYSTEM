const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { withDatabase } = require('../helpers/mongoUri');
const { spawn, spawnSync } = require('node:child_process');

const hasTools = ['mongodump', 'mongorestore'].every((tool) => spawnSync('which', [tool]).status === 0);
const rehearsal = path.resolve(__dirname, '../../scripts/db/rehearse.js');

// A child process, so the rehearsal's own replica set and connections never touch this suite's.
const runRehearsal = () => new Promise((resolve) => {
  const child = spawn(process.execPath, [rehearsal], { env: { ...process.env, MONGO_URL: '' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

describe.skipIf(!hasTools)('backup and restore rehearsal (needs MongoDB Database Tools)', () => {
  it('restores an identical copy of every collection and its indexes', async () => {
    const { status, stdout, stderr } = await runRehearsal();
    expect(stderr).toBe('');
    expect(status).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ passed: true, differences: [] });
    expect(Object.keys(result.collections).sort()).toEqual([
      'accounttokens', 'admincontrols', 'auththrottles', 'categories', 'complaintdeletions', 'complaints', 'oauthstates', 'refreshtokens', 'users',
    ]);
    for (const count of Object.values(result.collections)) expect(count).toBeGreaterThan(0);
  }, 300000);

  describe('against this suite\'s database', () => {
    const { backup } = require('../../scripts/db/backup');
    const { restore } = require('../../scripts/db/restore');
    let out;
    const connections = [];
    const open = async (name) => {
      const connection = await mongoose.createConnection(withDatabase(process.env.TEST_MONGO_URI, name)).asPromise();
      connections.push(connection);
      return connection;
    };
    beforeEach(() => { out = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-backup-test-')); });
    afterEach(async () => {
      for (const connection of connections.splice(0)) { await connection.dropDatabase(); await connection.close(); }
      fs.rmSync(out, { recursive: true, force: true });
    });

    it('records each collection\'s indexes in the manifest, and a restore checks them', async () => {
      const source = await open(`ccir-idx-src-${Date.now()}`);
      await source.db.collection('things').insertMany([{ n: 1 }, { n: 2 }]);
      await source.db.collection('things').createIndex({ n: 1 }, { unique: true });
      const { archive, manifestPath, manifest } = await backup({ uri: withDatabase(process.env.TEST_MONGO_URI, source.name), out });
      expect(manifest.collections.things.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ key: { n: 1 }, unique: true })]));

      // A manifest demanding an index the archive cannot supply fails the restore's check.
      const tampered = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      tampered.collections.things.indexes.push({ key: { missing: 1 }, unique: true, sparse: false });
      fs.writeFileSync(manifestPath, JSON.stringify(tampered));
      const target = await open(`ccir-idx-dst-${Date.now()}`);
      await expect(restore({ archive, uri: withDatabase(process.env.TEST_MONGO_URI, target.name) }))
        .rejects.toThrow('things (indexes)');
    });

    it('keeps the checksum format, so older manifests still verify', async () => {
      const { databaseSnapshot } = require('../../scripts/db/common');
      const { EJSON } = mongoose.mongo.BSON;
      const crypto = require('node:crypto');
      const source = await open(`ccir-hash-${Date.now()}`);
      const docs = [{ _id: 2, v: 'b' }, { _id: 1, v: 'a' }, { _id: 3, v: new Date(0) }];
      await source.db.collection('items').insertMany(docs);
      const expected = crypto.createHash('sha256');
      [...docs].sort((x, y) => x._id - y._id).forEach((doc) => expected.update(EJSON.stringify(doc, { relaxed: false })));
      const snapshot = await databaseSnapshot(withDatabase(process.env.TEST_MONGO_URI, source.name));
      expect(snapshot.collections.items).toMatchObject({ count: 3, sha256: expected.digest('hex') });
    });

    it('refuses a non-empty target, and replaces it only with --drop --confirm-drop', async () => {
      const stamp = Date.now();
      const source = await open(`ccir-bk-src-${stamp}`);
      const target = await open(`ccir-bk-tgt-${stamp}`);
      await source.db.collection('complaints').insertMany([{ ref: 'A' }, { ref: 'B' }]);
      await target.db.collection('complaints').insertOne({ ref: 'KEEP-ME' });
      const { archive, manifest } = await backup({ uri: withDatabase(process.env.TEST_MONGO_URI, source.name), out });
      expect(manifest.collections.complaints.count).toBe(2);
      expect(fs.statSync(archive).size).toBeGreaterThan(0);
      // The archive holds every user's personal data and password hash.
      expect(fs.statSync(archive).mode & 0o777).toBe(0o600);

      const targetUri = withDatabase(process.env.TEST_MONGO_URI, target.name);
      await expect(restore({ archive, uri: targetUri })).rejects.toThrow(/not empty/);
      await expect(restore({ archive, uri: targetUri, drop: true })).rejects.toThrow(/--confirm-drop/);
      expect(await target.db.collection('complaints').countDocuments()).toBe(1);

      await expect(restore({ archive, uri: targetUri, drop: true, confirmDrop: true })).resolves.toMatchObject({ database: target.name });
      expect((await target.db.collection('complaints').find({}, { projection: { _id: 0 } }).sort({ ref: 1 }).toArray())).toEqual([{ ref: 'A' }, { ref: 'B' }]);
    }, 120000);

    // A live application keeps writing (every sign-in adds a refresh token), so a write can land
    // between the manifest snapshot and mongodump. Each wrapped dump inserts one document first.
    const writeBeforeEachDump = (collection, times) => {
      const common = require('../../scripts/db/common');
      const realRunTool = common.runTool;
      let writes = 0;
      return vi.spyOn(common, 'runTool').mockImplementation(async (bin, args) => {
        if (args.some((arg) => arg.startsWith('--archive=')) && writes < times) {
          writes += 1;
          await collection.insertOne({ ref: `LIVE-${writes}` });
        }
        return realRunTool(bin, args);
      });
    };

    it('writes a manifest that matches its archive when the database changes during the dump', async () => {
      const stamp = Date.now();
      const source = await open(`ccir-bk-live-${stamp}`);
      const target = await open(`ccir-bk-live-tgt-${stamp}`);
      await source.db.collection('complaints').insertMany([{ ref: 'A' }, { ref: 'B' }]);
      const spy = writeBeforeEachDump(source.db.collection('complaints'), 1);
      try {
        const { archive, manifest } = await backup({ uri: withDatabase(process.env.TEST_MONGO_URI, source.name), out });
        expect(manifest.collections.complaints.count).toBe(3);
        await expect(restore({ archive, uri: withDatabase(process.env.TEST_MONGO_URI, target.name) })).resolves.toMatchObject({ collections: 1 });
        expect(fs.readdirSync(out).sort()).toEqual([path.basename(archive), path.basename(archive).replace('.archive.gz', '.manifest.json')].sort());
      } finally {
        spy.mockRestore();
      }
    }, 120000);

    // Refresh tokens, throttle counters and sign-in state expire by themselves (TTL indexes), so
    // they change during a dump even with the application stopped.
    it('does not retry, or fail, because a self-expiring collection changed during the dump', async () => {
      const source = await open(`ccir-bk-ttl-${Date.now()}`);
      await source.db.collection('complaints').insertOne({ ref: 'A' });
      const sessions = source.db.collection('refreshtokens');
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await sessions.insertOne({ expiresAt: new Date(Date.now() + 60000) });
      const spy = writeBeforeEachDump(sessions, Infinity);
      try {
        const { manifest } = await backup({ uri: withDatabase(process.env.TEST_MONGO_URI, source.name), out });
        expect(manifest.collections.refreshtokens.selfExpiring).toBe(true);
        expect(manifest.collections.complaints.selfExpiring).toBeUndefined();
        expect(spy.mock.calls.filter(([, args]) => args.some((arg) => arg.startsWith('--archive='))).length).toBe(1);
      } finally {
        spy.mockRestore();
      }
    }, 120000);

    // --drop only drops the collections the archive holds; a newer collection would survive and
    // leave, for example, deletion-log entries for complaints the restore brought back.
    it('makes a replaced target an exact copy, dropping collections the backup does not have', async () => {
      const stamp = Date.now();
      const source = await open(`ccir-bk-exact-src-${stamp}`);
      const target = await open(`ccir-bk-exact-tgt-${stamp}`);
      await source.db.collection('complaints').insertOne({ ref: 'A' });
      await target.db.collection('complaints').insertOne({ ref: 'NEWER' });
      await target.db.collection('complaintdeletions').insertOne({ ref: 'A', reason: 'deleted after the backup' });
      const { archive } = await backup({ uri: withDatabase(process.env.TEST_MONGO_URI, source.name), out });

      await expect(restore({ archive, uri: withDatabase(process.env.TEST_MONGO_URI, target.name) })).rejects.toThrow(/not empty/);
      await restore({ archive, uri: withDatabase(process.env.TEST_MONGO_URI, target.name), drop: true, confirmDrop: true });
      const names = (await target.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
      expect(names).toEqual(['complaints']);
    }, 120000);

    it('keeps nothing and says why when the database changes during every attempt', async () => {
      const source = await open(`ccir-bk-busy-${Date.now()}`);
      await source.db.collection('complaints').insertOne({ ref: 'A' });
      const spy = writeBeforeEachDump(source.db.collection('complaints'), Infinity);
      try {
        await expect(backup({ uri: withDatabase(process.env.TEST_MONGO_URI, source.name), out }))
          .rejects.toThrow(/changed while it was being backed up \(complaints\).*3 attempts.*No backup was kept/);
        expect(fs.readdirSync(out)).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    }, 120000);
  });
});

if (!hasTools) {
  describe('backup and restore rehearsal', () => {
    it.skip('skipped: install MongoDB Database Tools to run it (see scripts/db/common.js)', () => {});
  });
}
