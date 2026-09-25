const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');
const { User } = require('../../models');

const login = (email, password) => unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({ email, password });

// A suspended user used to see "Invalid email or password", as if they had mistyped. They are told
// the account is suspended only when the password is right, so nothing is revealed to anyone else.
describe('signing in to a suspended account', () => {
  it('tells the owner, once the password is right, that the account is suspended', async () => {
    const user = await createUserFixture({ isActive: false });
    const response = await login(user.email, 'fixture-password');
    expect(response.status).toBe(403);
    expect(response.body.error).toEqual({ code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended. Contact an administrator.' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers a wrong password exactly as for any account', async () => {
    const user = await createUserFixture({ isActive: false });
    const suspended = await login(user.email, 'wrong-password');
    const missing = await login('nobody-here@example.test', 'wrong-password');
    expect(suspended.status).toBe(401);
    expect(suspended.body).toEqual(missing.body);
  });

  it('lets the account sign in again once an administrator reactivates it', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const user = await createUserFixture({ isActive: false });
    const reactivated = await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: true });
    expect(reactivated.status).toBe(200);
    expect((await login(user.email, 'fixture-password')).status).toBe(200);
  });
});

// The suspend dialog asks for an optional reason; it is kept with the account until reactivation,
// so another administrator can see why. A reason on any other change would be thrown away, so it is refused.
describe('recording a suspension', () => {
  it('records who suspended the account, when, and why, and clears it on reactivation', async () => {
    const { agent: admin, user: adminUser } = await createAuthenticatedAgent({ role: 'admin' });
    const user = await createUserFixture();
    const suspended = await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: false, reason: 'Repeated abusive reports' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.user).toMatchObject({ isActive: false, suspensionReason: 'Repeated abusive reports', suspendedBy: String(adminUser._id ?? adminUser.id) });
    expect(Date.parse(suspended.body.user.suspendedAt)).not.toBeNaN();

    const listed = await admin.get('/api/v1/users').query({ search: user.email });
    expect(listed.body.users[0]).toMatchObject({ suspensionReason: 'Repeated abusive reports' });

    const reactivated = await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: true });
    expect(reactivated.status).toBe(200);
    for (const field of ['suspendedAt', 'suspendedBy', 'suspensionReason']) expect(reactivated.body.user).not.toHaveProperty(field);
  });

  it('records the suspension without a reason when none is given', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const user = await createUserFixture();
    const suspended = await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: false });
    expect(suspended.status).toBe(200);
    expect(suspended.body.user.suspendedAt).toBeDefined();
    expect(suspended.body.user).not.toHaveProperty('suspensionReason');
  });

  it('refuses a reason on a change that is not a suspension, changing nothing', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const user = await createUserFixture({ role: 'citizen' });
    for (const body of [{ role: 'agency', reason: 'Joined the roads team' }, { name: 'New Name', reason: 'Typo' }, { isActive: true, reason: 'Appeal upheld' }]) {
      const response = await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    const listed = await admin.get('/api/v1/users').query({ search: user.email });
    expect(listed.body.users[0]).toMatchObject({ role: 'citizen', isActive: true });
  });

  it('refuses a new reason for an account that is already suspended, keeping the recorded one', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const user = await createUserFixture();
    await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: false, reason: 'First reason' });
    const again = await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: false, reason: 'Second reason' });
    expect(again.status).toBe(409);
    const listed = await admin.get('/api/v1/users').query({ search: user.email });
    expect(listed.body.users[0].suspensionReason).toBe('First reason');
    // Repeating the suspension without a reason changes nothing and is not an error.
    expect((await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: false })).status).toBe(200);
  });

  // Retirement removes the person's details; the suspension note is free text about them, so it goes too.
  it('removes the suspension record when a suspended account is retired', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const user = await createUserFixture();
    await unsafeRequest(admin, 'patch', `/api/v1/users/${user.id}`).send({ isActive: false, reason: 'Repeated abusive reports' });
    expect((await unsafeRequest(admin, 'delete', `/api/v1/users/${user.id}`).send({ reason: 'Left the area' })).status).toBe(200);
    const stored = await User.findById(user.id).lean();
    expect(stored).toMatchObject({ retirementReason: 'Left the area' });
    for (const field of ['suspendedAt', 'suspendedBy', 'suspensionReason']) expect(stored).not.toHaveProperty(field);
  });
});
