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
      'admincontrols', 'auththrottles', 'categories', 'complaintdeletions', 'complaints', 'oauthstates', 'refreshtokens', 'users',
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

    it('refuses a non-empty target, and replaces it only with --drop --confirm-drop', async () => {
      const stamp = Date.now();
      const source = await open(`ccir-bk-src-${stamp}`);
      const target = await open(`ccir-bk-tgt-${stamp}`);
      await source.db.collection('complaints').insertMany([{ ref: 'A' }, { ref: 'B' }]);
      await target.db.collection('complaints').insertOne({ ref: 'KEEP-ME' });
      const { archive, manifest } = await backup({ uri: withDatabase(process.env.TEST_MONGO_URI, source.name), out });
      expect(manifest.collections.complaints.count).toBe(2);
      expect(fs.statSync(archive).size).toBeGreaterThan(0);

      const targetUri = withDatabase(process.env.TEST_MONGO_URI, target.name);
      await expect(restore({ archive, uri: targetUri })).rejects.toThrow(/not empty/);
      await expect(restore({ archive, uri: targetUri, drop: true })).rejects.toThrow(/--confirm-drop/);
      expect(await target.db.collection('complaints').countDocuments()).toBe(1);

      await expect(restore({ archive, uri: targetUri, drop: true, confirmDrop: true })).resolves.toMatchObject({ database: target.name });
      expect((await target.db.collection('complaints').find({}, { projection: { _id: 0 } }).sort({ ref: 1 }).toArray())).toEqual([{ ref: 'A' }, { ref: 'B' }]);
    }, 120000);
  });
});

if (!hasTools) {
  describe('backup and restore rehearsal', () => {
    it.skip('skipped: install MongoDB Database Tools to run it (see scripts/db/common.js)', () => {});
  });
}
