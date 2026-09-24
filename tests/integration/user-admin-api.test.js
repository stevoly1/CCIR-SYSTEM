const { RefreshToken, User } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');

describe('administrator user list and account management', () => {
  let admin;
  let adminUser;

  beforeEach(async () => {
    ({ agent: admin, user: adminUser } = await createAuthenticatedAgent({ role: 'admin', name: 'Chi Admin' }));
  });

  it('lists users newest first with pagination, and never returns passwords', async () => {
    for (let i = 1; i <= 3; i += 1) await createUserFixture({ name: `Listed Person ${i}` });

    const first = await admin.get('/api/v1/users?page=1&limit=2');
    expect(first.status).toBe(200);
    expect(first.body.pagination).toEqual({ page: 1, limit: 2, total: 4, pages: 2 });
    expect(first.body.users.map((user) => user.name)).toEqual(['Listed Person 3', 'Listed Person 2']);
    expect(JSON.stringify(first.body)).not.toMatch(/password/i);

    const second = await admin.get('/api/v1/users?page=2&limit=2');
    expect(second.body.users.map((user) => user.name)).toEqual(['Listed Person 1', 'Chi Admin']);
  });

  it('filters by role', async () => {
    await createUserFixture({ role: 'agency', name: 'Ade Agency' });
    await createUserFixture({ role: 'citizen', name: 'Cee Citizen' });
    const response = await admin.get('/api/v1/users?role=agency');
    expect(response.body.users.map((user) => user.name)).toEqual(['Ade Agency']);
    expect(response.body.pagination.total).toBe(1);
  });

  it('searches name and email case-insensitively', async () => {
    await createUserFixture({ name: 'Ngozi Okafor', email: 'ngozi@example.test' });
    await createUserFixture({ name: 'Tunde Bello', email: 'OKAFOR.fan@example.test' });
    await createUserFixture({ name: 'Unrelated Person', email: 'someone@example.test' });
    const response = await admin.get('/api/v1/users?search=okafor');
    expect(response.body.users.map((user) => user.name).sort()).toEqual(['Ngozi Okafor', 'Tunde Bello']);
  });

  it('treats search text literally, never as a pattern', async () => {
    await createUserFixture({ name: 'Dot.Name Person' });
    await createUserFixture({ name: 'DotXName Person' });
    const literal = await admin.get(`/api/v1/users?search=${encodeURIComponent('Dot.Name')}`);
    expect(literal.body.users.map((user) => user.name)).toEqual(['Dot.Name Person']);
    const wildcard = await admin.get(`/api/v1/users?search=${encodeURIComponent('.*')}`);
    expect(wildcard.status).toBe(200);
    expect(wildcard.body.users).toEqual([]);
  });

  it('lets an administrator edit another user\'s details', async () => {
    const target = await createUserFixture({ name: 'Old Name' });
    const response = await unsafeRequest(admin, 'patch', `/api/v1/users/${target.id}`).send({ name: 'New Name' });
    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('New Name');
    expect((await User.findById(target.id)).name).toBe('New Name');
  });

  it('refuses to retire the administrator\'s own account from the admin route', async () => {
    const response = await unsafeRequest(admin, 'delete', `/api/v1/users/${adminUser.id}`).send({ reason: 'Leaving' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Use your profile settings to delete your own account');
    expect((await User.findById(adminUser.id)).isActive).toBe(true);
  });

  it.each([
    ['a detail edit', (id) => unsafeRequest(admin, 'patch', `/api/v1/users/${id}`).send({ name: 'Nobody' })],
    ['a role change', (id) => unsafeRequest(admin, 'patch', `/api/v1/users/${id}`).send({ role: 'agency' })],
    ['a retirement', (id) => unsafeRequest(admin, 'delete', `/api/v1/users/${id}`).send({ reason: 'Cleanup' })],
  ])('answers 404 for %s of an unknown user', async (_label, send) => {
    const response = await send('0123456789abcdef01234567');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses to give a user an email address another account already uses', async () => {
    await createUserFixture({ email: 'taken@example.test' });
    const target = await createUserFixture({ email: 'mine@example.test' });
    const response = await unsafeRequest(admin, 'patch', `/api/v1/users/${target.id}`).send({ email: 'Taken@Example.test' });
    expect(response.status).toBe(409);
    expect((await User.findById(target.id)).email).toBe('mine@example.test');
  });

  it('keeps a user signed in when an edit repeats their current role unchanged', async () => {
    const { user: target } = await createAuthenticatedAgent({ role: 'citizen', name: 'Stay Signed In' });
    expect(await RefreshToken.countDocuments({ user: target._id })).toBe(1);
    const response = await unsafeRequest(admin, 'patch', `/api/v1/users/${target.id}`).send({ name: 'Renamed Only', phone: '', role: 'citizen' });
    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('Renamed Only');
    expect(await RefreshToken.countDocuments({ user: target._id })).toBe(1);
  });

  it('keeps an administrator signed in after editing their own name', async () => {
    expect(await RefreshToken.countDocuments({ user: adminUser._id })).toBe(1);
    const response = await unsafeRequest(admin, 'patch', `/api/v1/users/${adminUser.id}`).send({ name: 'Chi Renamed', phone: '', role: 'admin' });
    expect(response.status).toBe(200);
    expect(await RefreshToken.countDocuments({ user: adminUser._id })).toBe(1);
  });

  it('still ends the sessions of a user whose role really changes', async () => {
    const { user: target } = await createAuthenticatedAgent({ role: 'citizen' });
    await unsafeRequest(admin, 'patch', `/api/v1/users/${target.id}`).send({ role: 'agency' });
    expect(await RefreshToken.countDocuments({ user: target._id })).toBe(0);
  });
});
