const mongoose = require('mongoose');
const { Complaint, User } = require('../../models');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');
const { parseMigrationArgs, runPhase1Migration } = require('../../scripts/migratePhase1');

describe('Phase 1 legacy migration', () => {
  it('accepts only the governed command modes', () => {
    expect(parseMigrationArgs(['--dry-run'])).toEqual({ mode: 'dry-run' });
    expect(parseMigrationArgs(['--verify'])).toEqual({ mode: 'verify' });
    expect(parseMigrationArgs(['--apply', '--backup-reference=phase1-preapply-snapshot'])).toEqual({
      mode: 'apply',
      backupReference: 'phase1-preapply-snapshot',
    });
    expect(() => parseMigrationArgs(['--apply'])).toThrow(/backup/i);
    expect(() => parseMigrationArgs(['--dry-run', '--unknown'])).toThrow(/unknown/i);
    expect(() => parseMigrationArgs([
      '--apply',
      '--backup-reference=first',
      '--backup-reference=second',
    ])).toThrow(/backup/i);
  });

  it('dry-runs, applies, verifies, reports dangling refs, and becomes idempotent', async () => {
    const now = new Date('2026-09-20T02:00:00.000Z');
    const legacyUserId = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: legacyUserId,
      name: 'Legacy User',
      email: 'legacy-user@example.test',
      password: 'preserved-hash',
      role: 'citizen',
      authProvider: 'local',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const reporter = await createUserFixture();
    const agency = await createUserFixture({ role: 'agency', name: 'Legacy Agency' });
    const assigned = await createComplaintFixture({ reporter, assignedTo: agency._id });
    const stale = await createComplaintFixture({ reporter, status: 'IN_PROGRESS', resolvedAt: new Date('2026-02-01T00:00:00.000Z') });
    const recordedResolution = new Date('2026-03-01T00:00:00.000Z');
    const resolvedFromHistory = await createComplaintFixture({
      reporter,
      status: 'RESOLVED',
      statusHistory: [{ status: 'RESOLVED', createdAt: recordedResolution, changedBy: reporter._id }],
    });
    const estimatedTime = new Date('2026-04-01T00:00:00.000Z');
    const estimatedResolution = await createComplaintFixture({ reporter, status: 'RESOLVED', statusHistory: [] });
    await Complaint.collection.updateOne(
      { _id: estimatedResolution._id },
      { $unset: { resolvedAt: 1 }, $set: { updatedAt: estimatedTime } },
    );
    const missingReporter = new mongoose.Types.ObjectId();
    const missingAssignee = new mongoose.Types.ObjectId();
    const missingActor = new mongoose.Types.ObjectId();
    await createComplaintFixture({
      reporter: missingReporter,
      assignedTo: missingAssignee,
      statusHistory: [{ status: 'PENDING', changedBy: missingActor }],
    });

    const dryRun = await runPhase1Migration({ mode: 'dry-run', now });
    expect(dryRun.totalChanges).toBeGreaterThan(0);
    expect(dryRun.changes).toMatchObject({
      usersActivated: 1,
      assignmentImports: 1,
      resolvedAtCleared: 1,
      resolvedAtFromHistory: 1,
      resolvedAtEstimated: 1,
    });
    expect((await User.collection.findOne({ _id: legacyUserId })).isActive).toBeUndefined();
    expect((await Complaint.findById(assigned.id)).assignmentHistory).toHaveLength(0);

    await expect(runPhase1Migration({ mode: 'apply', now })).rejects.toThrow(/backup/i);
    const applied = await runPhase1Migration({
      mode: 'apply',
      backupReference: 'phase1-preapply-snapshot',
      now,
    });
    expect(applied.backupReference).toBe('phase1-preapply-snapshot');
    expect(applied.totalChanges).toBe(dryRun.totalChanges);

    expect((await User.findById(legacyUserId)).isActive).toBe(true);
    const imported = await Complaint.findById(assigned.id);
    expect(imported.assignmentHistory).toHaveLength(1);
    expect(imported.assignmentHistory[0]).toMatchObject({
      type: 'LEGACY_STATE_IMPORT',
      next: { userId: agency._id, displayName: 'Legacy Agency', role: 'agency' },
      changedBy: null,
      migrationMarker: 'PHASE_1_MIGRATION',
    });
    expect((await Complaint.findById(stale.id)).resolvedAt).toBeUndefined();
    expect((await Complaint.findById(resolvedFromHistory.id)).resolvedAt).toEqual(recordedResolution);
    const estimated = await Complaint.findById(estimatedResolution.id);
    expect(estimated.resolvedAt).toEqual(estimatedTime);
    expect(estimated.resolvedAtEstimated).toBe(true);

    const verification = await runPhase1Migration({ mode: 'verify', now });
    expect(verification.invariantFailures).toEqual([]);
    expect(verification.dangling).toMatchObject({ reporters: 1, assignees: 1, actors: 1 });

    const secondApply = await runPhase1Migration({
      mode: 'apply',
      backupReference: 'phase1-preapply-snapshot',
      now,
    });
    expect(secondApply.totalChanges).toBe(0);
  });
});
