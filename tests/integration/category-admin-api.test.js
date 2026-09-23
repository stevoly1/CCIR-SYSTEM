const { Category } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { createComplaintFixture } = require('../fixtures/complaint');

describe('category administration API', () => {
  let admin;

  beforeEach(async () => {
    ({ agent: admin } = await createAuthenticatedAgent({ role: 'admin' }));
    await Category.init();
  });

  const post = (body) => unsafeRequest(admin, 'post', '/api/v1/categories').send(body);

  it.each([['Roads', 'roads'], ['Roads', '  ROADS  '], ['Street Lights', 'street   lights']])('rejects %s vs %j as CATEGORY_NAME_CONFLICT', async (first, second) => {
    expect((await post({ name: first })).status).toBe(201);
    const duplicate = await post({ name: second });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CATEGORY_NAME_CONFLICT');
  });

  it('lets exactly one of two concurrent case-variant creates win', async () => {
    const results = await Promise.all([post({ name: 'Drainage' }), post({ name: 'drainage' })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Category.countDocuments({ nameKey: 'drainage' })).toBe(1);
  });

  it('rejects a rename onto an existing name, but allows re-casing its own name', async () => {
    await createCategoryFixture({ name: 'Roads' });
    const drainage = await createCategoryFixture({ name: 'Drainage' });
    const clash = await unsafeRequest(admin, 'patch', `/api/v1/categories/${drainage.id}`).send({ name: 'ROADS' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('CATEGORY_NAME_CONFLICT');
    const recase = await unsafeRequest(admin, 'patch', `/api/v1/categories/${drainage.id}`).send({ name: 'DRAINAGE' });
    expect(recase.status).toBe(200);
    expect(recase.body.category.name).toBe('DRAINAGE');
  });

  it('protects Other with CATEGORY_PROTECTED', async () => {
    const other = await createCategoryFixture({ name: 'Other' });
    for (const [method, body] of [['patch', { isActive: false }], ['patch', { name: 'Misc' }], ['delete', undefined]]) {
      const response = await unsafeRequest(admin, method, `/api/v1/categories/${other.id}`).send(body);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CATEGORY_PROTECTED');
    }
    const configured = await unsafeRequest(admin, 'patch', `/api/v1/categories/${other.id}`).send({ defaultPriority: 'HIGH' });
    expect(configured.status).toBe(200);
  });

  it('deletes only inactive, unreferenced categories', async () => {
    const active = await createCategoryFixture({ name: 'Bridges' });
    const activeResponse = await unsafeRequest(admin, 'delete', `/api/v1/categories/${active.id}`);
    expect(activeResponse.status).toBe(409);
    expect(activeResponse.body.error.code).toBe('CATEGORY_IN_USE');

    const referenced = await createCategoryFixture({ name: 'Parks', isActive: false });
    await createComplaintFixture({ category: referenced });
    const referencedResponse = await unsafeRequest(admin, 'delete', `/api/v1/categories/${referenced.id}`);
    expect(referencedResponse.status).toBe(409);
    expect(referencedResponse.body.error.code).toBe('CATEGORY_IN_USE');

    const unused = await createCategoryFixture({ name: 'Markets', isActive: false });
    const ok = await unsafeRequest(admin, 'delete', `/api/v1/categories/${unused.id}`);
    expect(ok.status).toBe(200);
    expect(await Category.findById(unused.id)).toBeNull();
  });

  it('shapes the list by role and counts references for administrators', async () => {
    const roads = await createCategoryFixture({ name: 'Roads' });
    await createCategoryFixture({ name: 'Hidden', isActive: false });
    await createComplaintFixture({ category: roads });
    await createComplaintFixture({ category: roads });

    const adminList = await admin.get('/api/v1/categories');
    expect(adminList.body.categories.find((c) => c.name === 'Roads')).toMatchObject({ complaintCount: 2, isActive: true });
    expect(adminList.body.categories.find((c) => c.name === 'Hidden')).toMatchObject({ complaintCount: 0, isActive: false });

    const { agent: citizen } = await createAuthenticatedAgent({ role: 'citizen' });
    const citizenList = await citizen.get('/api/v1/categories');
    expect(citizenList.body.categories).toEqual([expect.objectContaining({ name: 'Roads' })]);
    expect(Object.keys(citizenList.body.categories[0]).sort()).toEqual(['_id', 'description', 'name']);

    const { agent: agency } = await createAuthenticatedAgent({ role: 'agency' });
    const agencyList = await agency.get('/api/v1/categories');
    expect(agencyList.body.categories).toHaveLength(2);
    expect(agencyList.body.categories[0].complaintCount).toBeUndefined();
  });

  it.each(['citizen', 'agency'])('forbids %s writes', async (role) => {
    const { agent } = await createAuthenticatedAgent({ role });
    const target = await createCategoryFixture({ name: `Target ${role}` });
    expect((await unsafeRequest(agent, 'post', '/api/v1/categories').send({ name: 'Nope' })).status).toBe(403);
    expect((await unsafeRequest(agent, 'patch', `/api/v1/categories/${target.id}`).send({ isActive: false })).status).toBe(403);
    expect((await unsafeRequest(agent, 'delete', `/api/v1/categories/${target.id}`)).status).toBe(403);
  });

  it('bounds name length', async () => {
    expect((await post({ name: 'x'.repeat(61) })).status).toBe(400);
    expect((await post({ name: 'x' })).status).toBe(400);
  });
});
