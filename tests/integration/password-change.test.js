const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createGoogleAgent } = require('../helpers/googleAuth');
const { RefreshToken, AccountToken } = require('../../models');
const emailService = require('../../services/emailService');
const { issueToken } = require('../../services/accountTokenService');

const change = (agent, body) => unsafeRequest(agent, 'post', '/api/v1/users/profile/password').send(body);
const login = (email, password) => unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({ email, password });

describe('change password', () => {
  beforeEach(() => { vi.spyOn(emailService, 'sendPasswordChangedEmail').mockResolvedValue(true); });

  it('changes it, keeps this session, ends the others, cancels pending links, and tells the account', async () => {
    const { agent, user, password } = await createAuthenticatedAgent();
    const other = request.agent(testServer());
    await unsafeRequest(other, 'post', '/api/v1/auth/login').send({ email: user.email, password });
    await issueToken({ userId: user._id, purpose: 'password_reset', requestedBy: user._id });
    const response = await change(agent, { currentPassword: password, newPassword: 'Brand-new-pass' });
    expect(response.status).toBe(200);
    expect((await agent.get('/api/v1/users/profile')).status).toBe(200);
    expect((await other.get('/api/v1/users/profile')).status).toBe(401);
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(1);
    expect(await AccountToken.countDocuments({ user: user._id, usedAt: null })).toBe(0);
    expect((await login(user.email, 'Brand-new-pass')).status).toBe(200);
    await vi.waitFor(() => expect(emailService.sendPasswordChangedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email })));
  });

  it('refuses a wrong current password, and locks after five', async () => {
    const { agent } = await createAuthenticatedAgent();
    for (let i = 0; i < 5; i += 1) {
      const wrong = await change(agent, { currentPassword: 'wrong-password', newPassword: 'Brand-new-pass' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    }
    expect((await change(agent, { currentPassword: 'fixture-password', newPassword: 'Brand-new-pass' })).status).toBe(429);
  });

  it.each([
    ['the same password', { currentPassword: 'fixture-password', newPassword: 'fixture-password' }, 'SAME_PASSWORD'],
    ['a short password', { currentPassword: 'fixture-password', newPassword: 'Seven-7' }, 'VALIDATION_ERROR'],
  ])('refuses %s', async (_label, body, code) => {
    const { agent } = await createAuthenticatedAgent();
    const response = await change(agent, body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
  });

  it('refuses the email address as the new password', async () => {
    const { agent, user } = await createAuthenticatedAgent();
    const response = await change(agent, { currentPassword: 'fixture-password', newPassword: user.email.toUpperCase() });
    expect(response.body.error.code).toBe('PASSWORD_REJECTED');
  });

  it('refuses a Google account', async () => {
    const { agent } = await createGoogleAgent();
    const response = await change(agent, { currentPassword: 'anything', newPassword: 'Brand-new-pass' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GOOGLE_ACCOUNT');
  });

  it('needs a session', async () => {
    expect((await change(request(testServer()), { currentPassword: 'x', newPassword: 'Brand-new-pass' })).status).toBe(401);
  });
});
