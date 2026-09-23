const { Category } = require('../../models');
const seedDefaultCategories = require('../../utils/seedCategories');
const { runPhase2Migration } = require('../../scripts/migratePhase2');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');

describe('default category seeding', () => {
  beforeEach(async () => {
    await Category.init();
  });

  it('stores the Phase 2 identity fields, so a fresh install passes migration verify', async () => {
    await seedDefaultCategories();
    const seeded = await Category.collection.find({}).sort({ name: 1 }).toArray();
    expect(seeded.map((c) => [c.name, c.nameKey, c.slug])).toEqual([
      ['Drainage', 'drainage', 'drainage'],
      ['Other', 'other', 'other'],
      ['Pothole', 'pothole', 'pothole'],
      ['Streetlight', 'streetlight', 'streetlight'],
      ['Waste Accumulation', 'waste accumulation', 'waste-accumulation'],
      ['Water Leakage', 'water leakage', 'water-leakage'],
    ]);
    expect((await runPhase2Migration({ mode: 'verify' })).invariantFailures).toEqual([]);
  });

  it('makes seeded names case-insensitively unique', async () => {
    await seedDefaultCategories();
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const response = await unsafeRequest(admin, 'post', '/api/v1/categories').send({ name: 'pothole' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_NAME_CONFLICT');
  });

  it('is idempotent and never overwrites an administrator’s configuration', async () => {
    await seedDefaultCategories();
    await Category.updateOne({ name: 'Pothole' }, { $set: { defaultPriority: 'LOW', isActive: false } });
    await seedDefaultCategories();
    expect(await Category.countDocuments()).toBe(6);
    expect(await Category.findOne({ name: 'Pothole' }).lean()).toMatchObject({ defaultPriority: 'LOW', isActive: false });
  });

  it('does not recreate a default that an administrator renamed', async () => {
    await seedDefaultCategories();
    const pothole = await Category.findOne({ name: 'Pothole' });
    pothole.name = 'Road damage';
    await pothole.save();
    await seedDefaultCategories();
    expect(await Category.countDocuments()).toBe(6);
    expect(await Category.exists({ nameKey: 'pothole' })).toBeNull();
  });

  // Phase 2 code starts before `migrate:phase2` runs, so legacy rows have no nameKey yet.
  it('recognises a legacy Other that predates nameKey instead of inserting a second one', async () => {
    await Category.collection.insertMany([
      { name: 'Other', slug: 'other', isActive: true, defaultPriority: 'LOW' },
      { name: 'Roads', slug: 'roads', isActive: true, defaultPriority: 'HIGH' },
    ]);
    await expect(seedDefaultCategories()).resolves.toBeUndefined();
    expect(await Category.countDocuments({ name: 'Other' })).toBe(1);
    expect(await Category.countDocuments()).toBe(2);
  });
});
