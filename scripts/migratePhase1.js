const mongoose = require('mongoose');
const { Complaint, User } = require('../models');

const parseMigrationArgs = (args) => {
  const allowed = new Set(['--dry-run', '--apply', '--verify']);
  const modeArgs = args.filter((arg) => allowed.has(arg));
  const backupArg = args.find((arg) => arg.startsWith('--backup-reference='));
  const backupArgs = args.filter((arg) => arg.startsWith('--backup-reference='));
  const unknown = args.find((arg) => !allowed.has(arg) && !arg.startsWith('--backup-reference='));
  if (unknown) throw new Error(`Unknown migration argument: ${unknown}`);
  if (modeArgs.length !== 1) throw new Error('Choose exactly one of --dry-run, --apply, or --verify');
  if (backupArgs.length > 1) throw new Error('Choose exactly one backup reference');

  const mode = modeArgs[0].slice(2);
  const backupReference = backupArg?.slice('--backup-reference='.length);
  if (mode === 'apply' && !backupReference) throw new Error('Apply requires a non-empty backup reference');
  if (mode !== 'apply' && backupArg) throw new Error('Backup reference is valid only with --apply');
  return { mode, ...(backupReference ? { backupReference } : {}) };
};

const referenceInventory = async (complaints) => {
  const userIds = await User.collection.distinct('_id');
  const known = new Set(userIds.map(String));
  const dangling = { reporters: 0, assignees: 0, actors: 0 };
  for (const complaint of complaints) {
    if (complaint.reporter && !known.has(String(complaint.reporter))) dangling.reporters += 1;
    if (complaint.assignedTo && !known.has(String(complaint.assignedTo))) dangling.assignees += 1;
    for (const entry of complaint.statusHistory || []) {
      if (entry.changedBy && !known.has(String(entry.changedBy))) dangling.actors += 1;
    }
  }
  return { dangling, known };
};

const analyzeMigration = async ({ now }) => {
  const [complaints, usersMissingActivity] = await Promise.all([
    Complaint.collection.find({}).toArray(),
    User.collection.find({ isActive: { $exists: false } }).toArray(),
  ]);
  const { dangling, known } = await referenceInventory(complaints);
  const assigneeIds = [...new Set(complaints.map((item) => item.assignedTo).filter(Boolean).map(String))];
  const assignees = await User.collection.find({
    _id: { $in: assigneeIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).toArray();
  const assigneeById = new Map(assignees.map((user) => [String(user._id), user]));
  const actions = [];
  const changes = {
    usersActivated: usersMissingActivity.length,
    assignmentImports: 0,
    resolvedAtCleared: 0,
    resolvedAtFromHistory: 0,
    resolvedAtEstimated: 0,
  };

  for (const user of usersMissingActivity) {
    actions.push({ collection: 'users', id: user._id, update: { $set: { isActive: true } } });
  }

  for (const complaint of complaints) {
    const set = {};
    const unset = {};
    const push = {};
    const hasImport = (complaint.assignmentHistory || []).some((entry) => entry.type === 'LEGACY_STATE_IMPORT');
    if (complaint.assignedTo && !hasImport && known.has(String(complaint.assignedTo))) {
      const assignee = assigneeById.get(String(complaint.assignedTo));
      push.assignmentHistory = {
        type: 'LEGACY_STATE_IMPORT',
        previous: null,
        next: { userId: assignee._id, displayName: assignee.name, role: assignee.role },
        changedBy: null,
        migrationMarker: 'PHASE_1_MIGRATION',
        reason: 'Imported current assignment during Phase 1 migration',
        createdAt: now,
      };
      changes.assignmentImports += 1;
    }

    if (complaint.status !== 'RESOLVED' && complaint.resolvedAt) {
      unset.resolvedAt = 1;
      set.resolvedAtEstimated = false;
      changes.resolvedAtCleared += 1;
    } else if (complaint.status === 'RESOLVED' && !complaint.resolvedAt) {
      const resolvedEntries = (complaint.statusHistory || [])
        .filter((entry) => entry.status === 'RESOLVED' && entry.createdAt)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (resolvedEntries[0]) {
        set.resolvedAt = resolvedEntries[0].createdAt;
        set.resolvedAtEstimated = false;
        changes.resolvedAtFromHistory += 1;
      } else {
        set.resolvedAt = complaint.updatedAt;
        set.resolvedAtEstimated = true;
        changes.resolvedAtEstimated += 1;
      }
    }

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(push).length) update.$push = push;
    if (Object.keys(update).length) actions.push({ collection: 'complaints', id: complaint._id, update });
  }

  return { actions, changes, dangling };
};

const verifyMigration = async () => {
  const complaints = await Complaint.collection.find({}).toArray();
  const { dangling } = await referenceInventory(complaints);
  const failures = [];
  const missingActivity = await User.collection.countDocuments({ isActive: { $exists: false } });
  if (missingActivity) failures.push({ invariant: 'USER_ACTIVITY_MISSING', count: missingActivity });

  let assignmentMissing = 0;
  let staleResolvedAt = 0;
  let missingResolvedAt = 0;
  const userIds = new Set((await User.collection.distinct('_id')).map(String));
  for (const complaint of complaints) {
    if (
      complaint.assignedTo
      && userIds.has(String(complaint.assignedTo))
      && !(complaint.assignmentHistory || []).some((entry) => entry.type === 'LEGACY_STATE_IMPORT')
    ) assignmentMissing += 1;
    if (complaint.status !== 'RESOLVED' && complaint.resolvedAt) staleResolvedAt += 1;
    if (complaint.status === 'RESOLVED' && !complaint.resolvedAt) missingResolvedAt += 1;
  }
  if (assignmentMissing) failures.push({ invariant: 'ASSIGNMENT_IMPORT_MISSING', count: assignmentMissing });
  if (staleResolvedAt) failures.push({ invariant: 'NON_RESOLVED_TIMESTAMP_PRESENT', count: staleResolvedAt });
  if (missingResolvedAt) failures.push({ invariant: 'RESOLVED_TIMESTAMP_MISSING', count: missingResolvedAt });
  return { mode: 'verify', dangling, invariantFailures: failures, totalChanges: 0 };
};

const runPhase1Migration = async ({ mode, backupReference, now = new Date() }) => {
  if (mode === 'verify') return verifyMigration();
  if (!['dry-run', 'apply'].includes(mode)) throw new Error(`Unsupported migration mode: ${mode}`);
  if (mode === 'apply' && !backupReference) throw new Error('Apply requires a backup reference');

  const analysis = await analyzeMigration({ now });
  if (mode === 'apply') {
    for (const action of analysis.actions) {
      const collection = action.collection === 'users' ? User.collection : Complaint.collection;
      await collection.updateOne({ _id: action.id }, action.update);
    }
  }
  return {
    mode,
    ...(backupReference ? { backupReference } : {}),
    changes: analysis.changes,
    dangling: analysis.dangling,
    totalChanges: Object.values(analysis.changes).reduce((sum, count) => sum + count, 0),
  };
};

const runCli = async () => {
  require('dotenv').config();
  const connectDB = require('../config/db');
  const options = parseMigrationArgs(process.argv.slice(2));
  await connectDB();
  try {
    const report = await runPhase1Migration(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseMigrationArgs, runPhase1Migration };
