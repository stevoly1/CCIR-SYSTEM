const path = require('node:path');
const { execFile } = require('node:child_process');

// Asynchronous on purpose: this test process hosts the in-memory mongod and drains its output
// pipe; a blocking spawnSync can let that pipe fill and stall the database mid-command.
const runCli = (env, ...args) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(__dirname, '../../scripts/migratePhase2.js'), ...args], { env: { ...process.env, ...env }, timeout: 30000 },
    (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
});
const mongoose = require('mongoose');
const { Category, Complaint } = require('../../models');
const { runPhase2Migration } = require('../../scripts/migratePhase2');

const legacyComplaint = (overrides) => ({
  referenceCode: `LEGACY-${new mongoose.Types.ObjectId()}`,
  description: 'Legacy complaint description',
  status: 'PENDING',
  priority: 'MEDIUM',
  reporter: new mongoose.Types.ObjectId(),
  images: [],
  statusHistory: [{ _id: new mongoose.Types.ObjectId(), status: 'PENDING', note: 'Report submitted', createdAt: new Date('2026-01-01') }],
  assignmentHistory: [],
  ai: { summary: 'x', tags: [] },
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  __v: 0,
  ...overrides,
});

describe('Phase 2 migration', () => {
  it('dry-runs without writing, applies, verifies, and is idempotent', async () => {
    await Category.init();
    const roadsId = new mongoose.Types.ObjectId();
    await Category.collection.insertMany([
      { _id: roadsId, name: 'Roads', slug: 'roads', isActive: true, defaultPriority: 'HIGH' },
      { name: 'Other', slug: 'other', isActive: true, defaultPriority: 'LOW' },
    ]);
    await Complaint.collection.insertMany([
      legacyComplaint({ category: roadsId, images: [{ url: 'u', publicId: 'p' }] }),
      legacyComplaint({
        category: new mongoose.Types.ObjectId(),
        ai: { summary: '', tags: [], error: 'TIMEOUT' },
        statusHistory: [
          { _id: new mongoose.Types.ObjectId(), status: 'PENDING', note: 'Report submitted', createdAt: new Date('2026-01-01') },
          { _id: new mongoose.Types.ObjectId(), status: 'IN_REVIEW', note: 'Looking', createdAt: new Date('2026-01-02') },
        ],
        status: 'IN_REVIEW',
      }),
    ]);

    const dry = await runPhase2Migration({ mode: 'dry-run' });
    expect(dry.changes).toMatchObject({ categoryNameKeys: 2, categorySnapshots: 2, danglingCategorySnapshots: 1, timelineEntries: 3, prioritySources: 2, aiFields: 2, editHistories: 2 });
    expect(await Category.collection.countDocuments({ nameKey: { $exists: true } })).toBe(0);

    const before = await runPhase2Migration({ mode: 'verify' });
    expect(before.invariantFailures.map((f) => f.invariant)).toEqual(expect.arrayContaining(['CATEGORY_NAME_KEY_MISSING', 'COMPLAINT_FIELDS_MISSING', 'TIMELINE_NOT_TYPED']));

    const applied = await runPhase2Migration({ mode: 'apply', backupReference: 'phase2-preapply' });
    expect(applied.totalChanges).toBe(dry.totalChanges);

    const verified = await runPhase2Migration({ mode: 'verify' });
    expect(verified.invariantFailures).toEqual([]);

    const [roadsComplaint, danglingComplaint] = await Complaint.collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
    expect(roadsComplaint.categorySnapshot).toEqual({ categoryId: roadsId, name: 'Roads' });
    expect(roadsComplaint.ai).toMatchObject({ inputMode: 'TEXT_AND_IMAGE', analysisCount: 1 });
    expect(roadsComplaint.prioritySource).toBe('AI');
    expect(danglingComplaint.categorySnapshot.name).toBe('Unavailable category');
    expect(danglingComplaint.prioritySource).toBe('CATEGORY_DEFAULT');
    expect(danglingComplaint.statusHistory.map((e) => [e.type, e.publicNote, e.note])).toEqual([
      ['CREATED', 'Report submitted', undefined],
      ['STATUS_CHANGED', 'Looking', undefined],
    ]);

    const again = await runPhase2Migration({ mode: 'apply', backupReference: 'phase2-second' });
    expect(again.totalChanges).toBe(0);
  });

  it('refuses to auto-merge case-duplicate categories and reports them', async () => {
    await Category.init();
    await Category.collection.insertMany([
      { name: 'Roads', slug: 'roads', isActive: true },
      { name: 'ROADS', slug: 'roads-2', isActive: true },
    ]);
    const applied = await runPhase2Migration({ mode: 'apply', backupReference: 'dup-check' });
    expect(applied.duplicateNameKeys).toEqual([{ nameKey: 'roads', names: ['ROADS', 'Roads'] }]);
    const verified = await runPhase2Migration({ mode: 'verify' });
    expect(verified.invariantFailures).toContainEqual(expect.objectContaining({ invariant: 'CATEGORY_NAME_KEY_DUPLICATE' }));
  });

  it('flags a withdrawn complaint that still has an assignee', async () => {
    await Complaint.collection.insertOne(legacyComplaint({ status: 'WITHDRAWN', assignedTo: new mongoose.Types.ObjectId(), category: new mongoose.Types.ObjectId() }));
    await runPhase2Migration({ mode: 'apply', backupReference: 'withdrawn-check' });
    const verified = await runPhase2Migration({ mode: 'verify' });
    expect(verified.invariantFailures).toContainEqual(expect.objectContaining({ invariant: 'WITHDRAWN_WITH_ASSIGNEE', count: 1 }));
  });

  // Carried from Task 11: the 2–60 name bound would make an out-of-range legacy category fail
  // its next save (for example deactivation), so it must surface before deployment.
  it('reports legacy category names outside the 2–60 character bound without rewriting them', async () => {
    await Category.init();
    const longName = 'L'.repeat(61);
    await Category.collection.insertMany([
      { name: 'X', slug: 'x', isActive: true },
      { name: longName, slug: 'long', isActive: true },
      { name: '  Street   lights ', slug: 'street-lights', isActive: true },
    ]);
    const dry = await runPhase2Migration({ mode: 'dry-run' });
    expect(dry.categoryNamesOutOfRange).toEqual([{ name: longName, length: 61 }, { name: 'X', length: 1 }]);
    await runPhase2Migration({ mode: 'apply', backupReference: 'length-check' });
    expect(await Category.collection.countDocuments({ name: 'X' })).toBe(1);
    const verified = await runPhase2Migration({ mode: 'verify' });
    expect(verified.invariantFailures).toEqual([
      expect.objectContaining({ invariant: 'CATEGORY_NAME_OUT_OF_RANGE', count: 2 }),
    ]);
  });

  it('migrates a legacy complaint whose ai field is null', async () => {
    await Complaint.collection.insertOne(legacyComplaint({ ai: null, category: new mongoose.Types.ObjectId() }));
    await runPhase2Migration({ mode: 'apply', backupReference: 'null-ai' });
    const [migrated] = await Complaint.collection.find({}).toArray();
    expect(migrated.ai).toMatchObject({ inputMode: 'TEXT_ONLY', analysisCount: 1 });
    expect(migrated.prioritySource).toBe('AI');
    const verified = await runPhase2Migration({ mode: 'verify' });
    expect(verified.invariantFailures).toEqual([]);
  });

  it('stops rather than stamp a stale nameKey on a category renamed during the migration', async () => {
    await Category.init();
    const id = new mongoose.Types.ObjectId();
    // The live row was renamed by the application (which sets nameKey) after analysis read it.
    await Category.collection.insertOne({ _id: id, name: 'Road works', nameKey: 'road works', slug: 'road-works', isActive: true });
    const realFind = Category.collection.find.bind(Category.collection);
    vi.spyOn(Category.collection, 'find')
      .mockReturnValueOnce({ toArray: async () => [{ _id: id, name: 'Roads', slug: 'roads', isActive: true }] })
      .mockImplementation(realFind);
    await expect(runPhase2Migration({ mode: 'apply', backupReference: 'rename-race' })).rejects.toThrow(/changed during migration/);
    expect((await Category.collection.findOne({ _id: id })).nameKey).toBe('road works');
  });

  it('runs end to end from the command line and fails verify with a non-zero exit code', async () => {
    const { host, port, name } = mongoose.connection;
    const run = (...args) => runCli({ MONGO_URL: `mongodb://${host}:${port}/${name}?directConnection=true` }, ...args);
    await Category.collection.insertOne({ name: 'Roads', slug: 'roads', isActive: true });

    const failing = await run('--verify');
    expect(failing.status).toBe(2);
    expect(JSON.parse(failing.stdout).invariantFailures).toContainEqual(expect.objectContaining({ invariant: 'CATEGORY_NAME_KEY_MISSING' }));

    const applied = await run('--apply', '--backup-reference=cli-rehearsal');
    expect(applied.status).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ mode: 'apply', backupReference: 'cli-rehearsal', changes: { categoryNameKeys: 1 } });

    const passing = await run('--verify');
    expect(passing.status).toBe(0);
    expect(JSON.parse(passing.stdout).invariantFailures).toEqual([]);
  });

  it('rejects invalid command lines before connecting to a database', async () => {
    const run = (...args) => runCli({ MONGO_URL: 'mongodb://127.0.0.1:1/unreachable' }, ...args);
    const unknown = await run('--dry-run', '--everything');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown migration argument: --everything/);
    const noBackup = await run('--apply');
    expect(noBackup.status).toBe(1);
    expect(noBackup.stderr).toMatch(/backup reference/i);
  });
});
