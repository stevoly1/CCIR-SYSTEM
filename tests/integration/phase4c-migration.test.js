const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const mongoose = require('mongoose');
const { AccountToken, Complaint, User } = require('../../models');
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
const legacyReport = (overrides = {}) => ({
  referenceCode: `LEG-${new mongoose.Types.ObjectId()}`, description: 'Legacy report text here', category: new mongoose.Types.ObjectId(),
  reporter: new mongoose.Types.ObjectId(), status: 'PENDING', priority: 'MEDIUM', createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-03-01'),
  ...overrides,
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

    expect(await runPhase4cMigration({ mode: 'dry-run' })).toMatchObject({ changes: { googleAccountsToVerify: 1, legacyEmailChangeLinks: 1, reportsWithoutClassificationState: 0 }, totalChanges: 2 });
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

  it('gives legacy reports a classification state, preserving provenance and staying idempotent', async () => {
    const classified = await Complaint.collection.insertOne(legacyReport({ ai: { suggestedCategory: 'Roads', classifiedAt: new Date('2026-03-01'), error: null } }));
    const timedOut = await Complaint.collection.insertOne(legacyReport({ ai: { classifiedAt: new Date('2026-03-02'), error: 'TIMEOUT' } }));
    const providerError = await Complaint.collection.insertOne(legacyReport({ ai: { classifiedAt: new Date('2026-03-03'), error: 'PROVIDER_ERROR' } }));
    const networkError = await Complaint.collection.insertOne(legacyReport({ ai: { error: 'NETWORK_ERROR' } }));
    const invalid = await Complaint.collection.insertOne(legacyReport({ ai: { classifiedAt: new Date('2026-03-04'), error: 'INVALID_OUTPUT' } }));
    const noAi = await Complaint.collection.insertOne(legacyReport());
    const nullStatus = await Complaint.collection.insertOne(legacyReport({ ai: { status: null, error: 'TIMEOUT' } }));

    expect(await runPhase4cMigration({ mode: 'dry-run' })).toMatchObject({ changes: { reportsWithoutClassificationState: 7 } });
    expect((await runPhase4cMigration({ mode: 'verify' })).invariantFailures).toContainEqual({ invariant: 'REPORT_WITHOUT_CLASSIFICATION_STATE', count: 7 });
    await runPhase4cMigration({ mode: 'apply', backupReference: 'test-backup' });
    const read = (id) => Complaint.collection.findOne({ _id: id });
    expect(await read(classified.insertedId)).toMatchObject({ categorySource: 'AI', ai: { status: 'DONE', requestSeq: 1, provider: 'gemini' } });
    expect((await read(classified.insertedId)).ai.failureCode).toBeUndefined();
    expect(await read(timedOut.insertedId)).toMatchObject({ categorySource: 'FALLBACK', ai: { status: 'FAILED', failureCode: 'TIMEOUT', failedAt: new Date('2026-03-02') } });
    expect((await read(timedOut.insertedId)).ai.provider).toBeUndefined();
    expect((await read(providerError.insertedId)).ai.failureCode).toBe('PROVIDER_DOWN');
    expect(await read(networkError.insertedId)).toMatchObject({ ai: { failureCode: 'PROVIDER_DOWN', failedAt: new Date('2026-03-01') } });
    expect((await read(invalid.insertedId)).ai.failureCode).toBe('INVALID_OUTPUT');
    expect(await read(noAi.insertedId)).toMatchObject({ categorySource: 'AI', ai: { status: 'DONE', requestSeq: 1 } });
    expect(await read(nullStatus.insertedId)).toMatchObject({ categorySource: 'FALLBACK', ai: { status: 'FAILED', failureCode: 'TIMEOUT' } });
    expect(await runPhase4cMigration({ mode: 'apply', backupReference: 'test-backup' })).toMatchObject({ totalChanges: 0 });
    expect((await runPhase4cMigration({ mode: 'verify' })).invariantFailures).toEqual([]);
  });

  it('preserves a report with a current classification state', async () => {
    const current = await Complaint.collection.insertOne(legacyReport({ categorySource: 'CITIZEN', ai: { status: 'PENDING', requestSeq: 3 } }));
    await runPhase4cMigration({ mode: 'apply', backupReference: 'test-backup' });
    expect(await Complaint.collection.findOne({ _id: current.insertedId })).toMatchObject({ categorySource: 'CITIZEN', ai: { status: 'PENDING', requestSeq: 3 } });
  });
});
