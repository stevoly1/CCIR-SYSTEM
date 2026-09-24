const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');

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
