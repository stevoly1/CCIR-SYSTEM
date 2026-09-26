const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const mongoose = require('mongoose');
const { AccountToken, User } = require('../../models');
const { runPhase4cMigration } = require('../../scripts/migratePhase4c');

// Run from an empty folder, so a developer's .env can never reach the child process.
const runCli = (env, ...args) => new Promise((resolve) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-migrate-'));
  execFile(process.execPath, [path.join(__dirname, '../../scripts/migratePhase4c.js'), ...args], { cwd, env: { ...process.env, ...env }, timeout: 30000 },
    (error, stdout, stderr) => {
      fs.rmSync(cwd, { recursive: true, force: true });
      resolve({ status: error ? error.code : 0, stdout, stderr });
    });
});

const legacyUser = (overrides) => ({
  name: 'Legacy Person', email: `legacy-${new mongoose.Types.ObjectId()}@example.test`, role: 'citizen', isActive: true, authProvider: 'local',
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...overrides,
});
const legacyLink = (userId, overrides = {}) => ({
  purpose: 'email_change', user: userId, tokenHash: new mongoose.Types.ObjectId().toString().padEnd(64, 'a'), newEmail: 'x@example.test',
  requestedBy: userId, expiresAt: new Date(Date.now() + 3600000), usedAt: null, ...overrides,
});

describe('Phase 4c migration', () => {
  it('dry-runs without writing, applies, verifies, and is idempotent', async () => {
    const google = await User.collection.insertOne(legacyUser({ authProvider: 'google', googleId: 'g-1' }));
    const googleVerified = await User.collection.insertOne(legacyUser({ authProvider: 'google', googleId: 'g-3', emailVerifiedAt: new Date('2026-02-02') }));
    const local = await User.collection.insertOne(legacyUser({}));
    await AccountToken.collection.insertOne(legacyLink(local.insertedId));
    // Kept: a used link, a link that belongs to an email change, and a reset link.
    await AccountToken.collection.insertOne(legacyLink(local.insertedId, { usedAt: new Date() }));
    await AccountToken.collection.insertOne(legacyLink(local.insertedId, { emailChange: new mongoose.Types.ObjectId() }));
    await AccountToken.collection.insertOne(legacyLink(local.insertedId, { purpose: 'password_reset', newEmail: undefined }));

    expect(await runPhase4cMigration({ mode: 'dry-run' })).toMatchObject({ changes: { googleAccountsToVerify: 1, legacyEmailChangeLinks: 1 }, totalChanges: 2 });
    expect((await User.collection.findOne({ _id: google.insertedId })).emailVerifiedAt).toBeUndefined();
    expect(await AccountToken.countDocuments()).toBe(4);
    expect((await runPhase4cMigration({ mode: 'verify' })).invariantFailures).toEqual([
      { invariant: 'GOOGLE_ACCOUNT_UNVERIFIED', count: 1 }, { invariant: 'LEGACY_EMAIL_CHANGE_LINK', count: 1 },
    ]);
    await expect(runPhase4cMigration({ mode: 'apply' })).rejects.toThrow(/backup reference/);

    expect(await runPhase4cMigration({ mode: 'apply', backupReference: 'backup-2026-09-25' })).toMatchObject({ mode: 'apply', backupReference: 'backup-2026-09-25', totalChanges: 2 });
    expect((await User.collection.findOne({ _id: google.insertedId })).emailVerifiedAt).toEqual(new Date('2026-01-01'));
    expect((await User.collection.findOne({ _id: googleVerified.insertedId })).emailVerifiedAt).toEqual(new Date('2026-02-02'));
    // Email-and-password accounts verify themselves.
    expect((await User.collection.findOne({ _id: local.insertedId })).emailVerifiedAt).toBeUndefined();
    expect(await AccountToken.countDocuments()).toBe(3);
    expect((await runPhase4cMigration({ mode: 'verify' })).invariantFailures).toEqual([]);
    expect((await runPhase4cMigration({ mode: 'dry-run' })).totalChanges).toBe(0);
  });

  it('runs end to end from the command line and fails verify with a non-zero exit code', async () => {
    const { host, port, name } = mongoose.connection;
    const run = (...args) => runCli({ MONGO_URL: `mongodb://${host}:${port}/${name}?directConnection=true` }, ...args);
    await User.collection.insertOne(legacyUser({ authProvider: 'google', googleId: 'g-2' }));

    const failing = await run('--verify');
    expect(failing.status).toBe(2);
    expect(JSON.parse(failing.stdout).invariantFailures).toContainEqual({ invariant: 'GOOGLE_ACCOUNT_UNVERIFIED', count: 1 });
    const applied = await run('--apply', '--backup-reference=backup-1');
    expect(applied.status).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ mode: 'apply', backupReference: 'backup-1', changes: { googleAccountsToVerify: 1 } });
    expect((await run('--verify')).status).toBe(0);
  });

  it('rejects invalid command lines before connecting to a database', async () => {
    const run = (...args) => runCli({ MONGO_URL: 'mongodb://127.0.0.1:1/unreachable' }, ...args);
    const noBackup = await run('--apply');
    expect(noBackup.status).toBe(1);
    expect(noBackup.stderr).toMatch(/backup reference/i);
    expect((await run('--dry-run', '--everything')).stderr).toMatch(/Unknown migration argument: --everything/);
  });
});
