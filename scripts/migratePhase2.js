const mongoose = require('mongoose');
const { Category, Complaint } = require('../models');
const { parseMigrationArgs } = require('./migratePhase1');
const { cleanCategoryName, normaliseCategoryName } = require('../utils/categoryName');

const NAME_MIN = 2;
const NAME_MAX = 60;

// The Phase 2 schema bounds names to 2–60 characters, so an out-of-range legacy category
// would fail its next save (for example deactivation). Such names are reported for manual
// renaming, never rewritten.
const namesOutOfRange = (categories) => categories
  .map((category) => ({ name: category.name, length: cleanCategoryName(category.name).length }))
  .filter(({ length }) => length < NAME_MIN || length > NAME_MAX)
  .sort((a, b) => a.name.localeCompare(b.name));

const planCategories = (categories) => {
  const groups = new Map();
  for (const category of categories) {
    const key = normaliseCategoryName(category.name);
    groups.set(key, [...(groups.get(key) ?? []), category]);
  }
  const actions = [];
  const duplicateNameKeys = [];
  for (const [nameKey, members] of groups) {
    if (members.length > 1) {
      duplicateNameKeys.push({ nameKey, names: members.map((m) => m.name).sort() });
      continue;
    }
    if (members[0].nameKey !== nameKey) actions.push({ id: members[0]._id, name: members[0].name, update: { $set: { nameKey } } });
  }
  return { actions, duplicateNameKeys };
};

const planComplaint = (complaint, categoryNames) => {
  const set = {};
  const changes = { categorySnapshots: 0, danglingCategorySnapshots: 0, timelineEntries: 0, prioritySources: 0, aiFields: 0, editHistories: 0 };
  if (!complaint.categorySnapshot) {
    const name = categoryNames.get(String(complaint.category));
    set.categorySnapshot = { categoryId: complaint.category, name: name ?? 'Unavailable category' };
    changes.categorySnapshots += 1;
    if (!name) changes.danglingCategorySnapshots += 1;
  }
  const history = complaint.statusHistory ?? [];
  if (history.some((entry) => !entry.type || entry.note !== undefined)) {
    set.statusHistory = history.map((entry, index) => {
      const { note, ...rest } = entry;
      if (!entry.type || note !== undefined) changes.timelineEntries += 1;
      return {
        ...rest,
        type: entry.type ?? (index === 0 ? 'CREATED' : 'STATUS_CHANGED'),
        ...(rest.publicNote === undefined && note ? { publicNote: note } : {}),
      };
    });
  }
  if (!complaint.prioritySource) {
    set.prioritySource = complaint.ai?.error ? 'CATEGORY_DEFAULT' : 'AI';
    changes.prioritySources += 1;
  }
  if (!complaint.ai?.inputMode || !complaint.ai?.analysisCount) {
    const inputMode = (complaint.images ?? []).length ? 'TEXT_AND_IMAGE' : 'TEXT_ONLY';
    if (complaint.ai === null || complaint.ai === undefined) {
      // A dotted $set cannot create fields inside a null `ai`, so write the object whole.
      set.ai = { tags: [], inputMode, analysisCount: 1 };
    } else {
      if (!complaint.ai.inputMode) set['ai.inputMode'] = inputMode;
      if (!complaint.ai.analysisCount) set['ai.analysisCount'] = 1;
    }
    changes.aiFields += 1;
  }
  if (!Array.isArray(complaint.editHistory)) {
    set.editHistory = [];
    changes.editHistories += 1;
  }
  return { set, changes };
};

const analyze = async () => {
  const [categories, complaints] = await Promise.all([
    Category.collection.find({}).toArray(),
    Complaint.collection.find({}).toArray(),
  ]);
  const categoryPlan = planCategories(categories);
  const categoryNames = new Map(categories.map((c) => [String(c._id), c.name]));
  const changes = { categoryNameKeys: categoryPlan.actions.length, categorySnapshots: 0, danglingCategorySnapshots: 0, timelineEntries: 0, prioritySources: 0, aiFields: 0, editHistories: 0 };
  const complaintActions = [];
  for (const complaint of complaints) {
    const { set, changes: delta } = planComplaint(complaint, categoryNames);
    Object.entries(delta).forEach(([key, count]) => { changes[key] += count; });
    if (Object.keys(set).length) complaintActions.push({ id: complaint._id, version: complaint.__v, update: { $set: set } });
  }
  return { categoryPlan, complaintActions, changes, categoryNamesOutOfRange: namesOutOfRange(categories) };
};

const totalOf = (changes) => Object.entries(changes)
  .filter(([key]) => key !== 'danglingCategorySnapshots')
  .reduce((sum, [, count]) => sum + count, 0);

const verify = async () => {
  const failures = [];
  const categories = await Category.collection.find({}).toArray();
  const missingKey = categories.filter((c) => !c.nameKey).length;
  if (missingKey) failures.push({ invariant: 'CATEGORY_NAME_KEY_MISSING', count: missingKey });
  const { duplicateNameKeys } = planCategories(categories);
  if (duplicateNameKeys.length) failures.push({ invariant: 'CATEGORY_NAME_KEY_DUPLICATE', count: duplicateNameKeys.length, details: duplicateNameKeys });
  const outOfRange = namesOutOfRange(categories);
  if (outOfRange.length) failures.push({ invariant: 'CATEGORY_NAME_OUT_OF_RANGE', count: outOfRange.length, details: outOfRange });
  const indexes = await Category.collection.indexes();
  if (!indexes.some((index) => index.key?.nameKey === 1 && index.unique)) failures.push({ invariant: 'CATEGORY_NAME_KEY_INDEX_MISSING', count: 1 });

  const complaints = await Complaint.collection.find({}).toArray();
  const missingFields = complaints.filter((c) => !c.categorySnapshot || !c.prioritySource || !c.ai?.inputMode || !c.ai?.analysisCount || !Array.isArray(c.editHistory)).length;
  if (missingFields) failures.push({ invariant: 'COMPLAINT_FIELDS_MISSING', count: missingFields });
  const untyped = complaints.filter((c) => (c.statusHistory ?? []).some((e) => !e.type || e.note !== undefined)).length;
  if (untyped) failures.push({ invariant: 'TIMELINE_NOT_TYPED', count: untyped });
  const withdrawnAssigned = complaints.filter((c) => c.status === 'WITHDRAWN' && c.assignedTo).length;
  if (withdrawnAssigned) failures.push({ invariant: 'WITHDRAWN_WITH_ASSIGNEE', count: withdrawnAssigned });
  return { mode: 'verify', invariantFailures: failures, totalChanges: 0 };
};

const runPhase2Migration = async ({ mode, backupReference }) => {
  if (mode === 'verify') return verify();
  if (!['dry-run', 'apply'].includes(mode)) throw new Error(`Unsupported migration mode: ${mode}`);
  if (mode === 'apply' && !backupReference) throw new Error('Apply requires a backup reference');
  const { categoryPlan, complaintActions, changes, categoryNamesOutOfRange } = await analyze();
  if (mode === 'apply') {
    for (const action of categoryPlan.actions) {
      // Guarded on the analysed name: a rename since analysis would otherwise receive the old key.
      const result = await Category.collection.updateOne({ _id: action.id, name: action.name }, action.update);
      if (result.matchedCount !== 1) throw new Error(`Category ${action.id} changed during migration; re-run after it settles`);
    }
    if (categoryPlan.duplicateNameKeys.length === 0) await Category.createIndexes();
    for (const action of complaintActions) {
      const result = await Complaint.collection.updateOne({ _id: action.id, __v: action.version }, action.update);
      if (result.matchedCount !== 1) throw new Error(`Complaint ${action.id} changed during migration; re-run after it settles`);
    }
  }
  return {
    mode,
    ...(backupReference ? { backupReference } : {}),
    changes,
    duplicateNameKeys: categoryPlan.duplicateNameKeys,
    categoryNamesOutOfRange,
    totalChanges: totalOf(changes),
  };
};

const runCli = async () => {
  // Quiet: stdout carries only the JSON report, so dotenv's banner must not reach it.
  require('dotenv').config({ quiet: true });
  const options = parseMigrationArgs(process.argv.slice(2));
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL is required');
  // Connect directly rather than through config/db, whose connection log would reach stdout.
  await mongoose.connect(process.env.MONGO_URL);
  try {
    const report = await runPhase2Migration(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    // A failed verify must stop a deploy script, so it exits non-zero (2, distinct from errors).
    if (report.mode === 'verify' && report.invariantFailures.length) process.exitCode = 2;
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

module.exports = { runPhase2Migration };
