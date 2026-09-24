const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, assertRestoreAllowed, requireTool, withToolConfig } = require('../../scripts/db/common');

describe('database script helpers', () => {
  it('parses flags and values', () => {
    expect(parseArgs(['--out', 'backups', '--drop', '--confirm-drop'])).toEqual({ out: 'backups', drop: true, 'confirm-drop': true });
  });

  it('restores into an empty target', () => {
    expect(() => assertRestoreAllowed({ targetIsEmpty: true, drop: false, confirmDrop: false })).not.toThrow();
  });

  it.each([
    [{ targetIsEmpty: false, drop: false, confirmDrop: false }, /not empty/],
    [{ targetIsEmpty: false, drop: true, confirmDrop: false }, /--confirm-drop/],
    [{ targetIsEmpty: false, drop: false, confirmDrop: true }, /not empty/],
  ])('refuses %o', (input, message) => {
    expect(() => assertRestoreAllowed(input)).toThrow(message);
  });

  it('allows replacing a non-empty target only with both flags', () => {
    expect(() => assertRestoreAllowed({ targetIsEmpty: false, drop: true, confirmDrop: true })).not.toThrow();
  });

  it('explains how to install a missing tool', () => {
    expect(() => requireTool('definitely-not-a-mongo-tool')).toThrow(/MongoDB Database Tools/);
  });

  it('hands the tool a private config file holding the URI, and deletes it only after the tool finishes', async () => {
    const uri = 'mongodb+srv://app:Config-Pass-1@cluster.example.net/ccir';
    let seen;
    await expect(withToolConfig(uri, async (file) => {
      seen = file;
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(file, 'utf8')).toBe(`uri: ${JSON.stringify(uri)}\n`);
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(fs.existsSync(file)).toBe(true);
      throw new Error('tool failed');
    })).rejects.toThrow('tool failed');
    expect(fs.existsSync(seen)).toBe(false);
  });

  it('runs a tool without blocking and reports its status and output', async () => {
    const { runTool } = require('../../scripts/db/common');
    const ticks = [];
    const timer = setInterval(() => ticks.push(Date.now()), 5);
    const result = await runTool(process.execPath, ['-e', "setTimeout(() => { process.stdout.write('out'); process.stderr.write('err'); process.exit(3); }, 100)"]);
    clearInterval(timer);
    expect(result).toEqual({ status: 3, stdout: 'out', stderr: 'err' });
    expect(ticks.length).toBeGreaterThan(3);
  });

  // Backups hold personal data; they must never be committable to the public repository.
  it.each(['backups/ccir-2026-01-01.archive.gz', 'backups/ccir-2026-01-01.manifest.json', 'nested/ccir-x.archive.gz'])(
    'keeps %s out of git',
    (file) => {
      const root = path.resolve(__dirname, '..', '..');
      expect(spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: root }).status).toBe(0);
    },
  );

  // The private records repository is nested at docs/; nothing in it may enter this public one.
  it('keeps the private records folder out of git', () => {
    const root = path.resolve(__dirname, '..', '..');
    expect(spawnSync('git', ['check-ignore', '-q', '--no-index', 'docs/remediation/any-record.md'], { cwd: root }).status).toBe(0);
  });

  // The records rule must match only the top-level docs/ folder, not the published API docs page.
  it.each(['openapi/docs/index.html', 'openapi/docs/init.js'])('keeps the published %s in git', (file) => {
    const root = path.resolve(__dirname, '..', '..');
    expect(spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: root }).status).toBe(1);
  });

  describe('restore refusals that happen before any database or tool is touched', () => {
    const { restore } = require('../../scripts/db/restore');
    let dir;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-restore-test-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('requires an explicit target and never falls back to MONGO_URL', async () => {
      vi.stubEnv('MONGO_URL', 'mongodb://should-not-be-used.example.test/ccir');
      await expect(restore({ archive: path.join(dir, 'x.archive.gz') })).rejects.toThrow(/An archive and a target are required; the target is never taken from MONGO_URL/);
      vi.unstubAllEnvs();
    });

    it('refuses an archive that does not match its manifest checksum', async () => {
      const archive = path.join(dir, 'ccir-test.archive.gz');
      fs.writeFileSync(archive, 'tampered bytes');
      fs.writeFileSync(archive.replace(/\.archive\.gz$/, '.manifest.json'), JSON.stringify({ archiveSha256: 'f'.repeat(64), database: 'ccir', collections: {} }));
      await expect(restore({ archive, uri: 'mongodb://127.0.0.1:9/never-contacted' })).rejects.toThrow('does not match its manifest checksum');
    });

    // Without a database in the connection string the driver silently picks "test".
    it.each([
      'mongodb://127.0.0.1:9',
      'mongodb://127.0.0.1:9/',
      'mongodb://u:p@127.0.0.1:9/?authSource=admin',
      'mongodb+srv://u:p@cluster.example.test/?retryWrites=true',
    ])('refuses a target that names no database: %s', async (uri) => {
      const error = await restore({ archive: path.join(dir, 'x.archive.gz'), uri }).catch((caught) => caught);
      expect(error.message).toMatch(/restore target must name its database/);
      expect(error.message).not.toContain('u:p@');
    });
  });

  // The command line is visible to every local user (ps) and kept in shell history, so a target
  // holding a password must come from the environment instead.
  describe('restoreTargetFrom', () => {
    const { restoreTargetFrom } = require('../../scripts/db/restore');
    const withPassword = 'mongodb+srv://admin:S3cretPw@cluster.example.test/ccir-restored';

    it('takes the target from RESTORE_TARGET_URL', () => {
      expect(restoreTargetFrom({ args: {}, env: { RESTORE_TARGET_URL: withPassword } })).toBe(withPassword);
    });

    it('accepts --uri only when it carries no password', () => {
      expect(restoreTargetFrom({ args: { uri: 'mongodb://127.0.0.1:27017/ccir-restored' }, env: {} })).toBe('mongodb://127.0.0.1:27017/ccir-restored');
      expect(restoreTargetFrom({ args: { uri: 'mongodb://backup-user@127.0.0.1:27017/ccir-restored?authMechanism=MONGODB-X509' }, env: {} }))
        .toBe('mongodb://backup-user@127.0.0.1:27017/ccir-restored?authMechanism=MONGODB-X509');
    });

    it('refuses a --uri that carries a password, without repeating it', () => {
      let error;
      try { restoreTargetFrom({ args: { uri: withPassword }, env: {} }); } catch (caught) { error = caught; }
      expect(error.message).toMatch(/RESTORE_TARGET_URL/);
      expect(error.message).not.toContain('S3cretPw');
    });

    it('refuses two targets, and never falls back to MONGO_URL', () => {
      expect(() => restoreTargetFrom({ args: { uri: 'mongodb://127.0.0.1:27017/a' }, env: { RESTORE_TARGET_URL: 'mongodb://127.0.0.1:27017/b' } })).toThrow(/either RESTORE_TARGET_URL or --uri, not both/);
      expect(restoreTargetFrom({ args: {}, env: { MONGO_URL: 'mongodb://127.0.0.1:27017/live' } })).toBeUndefined();
    });
  });

  describe('restoreMismatches', () => {
    const { restoreMismatches } = require('../../scripts/db/common');
    const manifest = {
      complaints: { count: 2, sha256: 'a' },
      refreshtokens: { count: 5, sha256: 'b', selfExpiring: true },
    };

    it('passes an exact copy', () => {
      expect(restoreMismatches(manifest, { complaints: { count: 2, sha256: 'a' }, refreshtokens: { count: 5, sha256: 'b' } })).toEqual([]);
    });

    // MongoDB deletes expired documents by itself, even from a restored copy.
    it('ignores the contents of self-expiring collections', () => {
      expect(restoreMismatches(manifest, { complaints: { count: 2, sha256: 'a' }, refreshtokens: { count: 3, sha256: 'c' } })).toEqual([]);
    });

    it('names a collection whose contents differ, or that is missing', () => {
      expect(restoreMismatches(manifest, { complaints: { count: 2, sha256: 'z' }, refreshtokens: { count: 5, sha256: 'b' } })).toEqual(['complaints']);
      expect(restoreMismatches(manifest, { refreshtokens: { count: 5, sha256: 'b' } })).toEqual(['complaints']);
    });

    // A restore must also bring back the indexes: without the unique ones the app refuses traffic,
    // and without a TTL one security data stops expiring.
    it('names a collection whose indexes differ from the backup', () => {
      const withIndexes = { complaints: { count: 2, sha256: 'a', indexes: [{ key: { _id: 1 }, unique: false, sparse: false }, { key: { referenceCode: 1 }, unique: true, sparse: false }] } };
      expect(restoreMismatches(withIndexes, { complaints: { count: 2, sha256: 'a', indexes: [{ key: { _id: 1 }, unique: false, sparse: false }] } })).toEqual(['complaints (indexes)']);
      expect(restoreMismatches(withIndexes, { complaints: { count: 2, sha256: 'a', indexes: withIndexes.complaints.indexes } })).toEqual([]);
    });

    it('does not compare indexes for a manifest written before they were recorded', () => {
      expect(restoreMismatches({ complaints: { count: 2, sha256: 'a' } }, { complaints: { count: 2, sha256: 'a', indexes: [] } })).toEqual([]);
    });

    it('names a self-expiring collection that was not restored at all', () => {
      expect(restoreMismatches(manifest, { complaints: { count: 2, sha256: 'a' } })).toEqual(['refreshtokens (missing)']);
    });

    it('names a non-empty collection the backup does not have, and ignores an empty one', () => {
      const after = { complaints: { count: 2, sha256: 'a' }, refreshtokens: { count: 5, sha256: 'b' } };
      expect(restoreMismatches(manifest, { ...after, complaintdeletions: { count: 1, sha256: 'd' } })).toEqual(['complaintdeletions (not in the backup)']);
      expect(restoreMismatches(manifest, { ...after, complaintdeletions: { count: 0, sha256: 'e' } })).toEqual([]);
    });
  });

  describe('databaseNameFrom', () => {
    const { databaseNameFrom } = require('../../scripts/db/common');
    it.each([
      ['mongodb://127.0.0.1:27017/ccir', 'ccir'],
      ['mongodb://a:1,b:2,c:3/ccir-restored?replicaSet=rs0', 'ccir-restored'],
      ['mongodb+srv://u:p%2Fq@cluster.example.test/ccir?retryWrites=true', 'ccir'],
      ['mongodb://127.0.0.1:27017/', null],
      ['mongodb://127.0.0.1:27017?replicaSet=rs0', null],
    ])('%s → %s', (uri, name) => expect(databaseNameFrom(uri)).toBe(name));
  });
});
