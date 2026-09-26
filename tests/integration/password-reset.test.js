const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');
const { RefreshToken, User } = require('../../models');
const emailService = require('../../services/emailService');
const { drainOutbox } = require('../helpers/jobs');
const { issueToken } = require('../../services/accountTokenService');
const { retireAccount } = require('../../services/accountRetirementService');

const api = () => request(testServer());
const forgot = (email) => unsafeRequest(api(), 'post', '/api/v1/auth/password/forgot').send({ email });
const reset = (token, password) => unsafeRequest(api(), 'post', '/api/v1/auth/password/reset').send({ token, password });
const login = (email, password) => unsafeRequest(api(), 'post', '/api/v1/auth/login').send({ email, password });

// The email work runs in a background job; this runs the queued jobs.
const afterForgot = async (email) => {
  const response = await forgot(email);
  await drainOutbox();
  return response;
};
const googleUser = (email, googleId) => createUserFixture({ email, authProvider: 'google', googleId, password: undefined });

describe('forgot password', () => {
  let resetMail; let googleMail;
  beforeEach(() => {
    resetMail = vi.spyOn(emailService, 'sendPasswordResetEmail').mockResolvedValue(undefined);
    googleMail = vi.spyOn(emailService, 'sendGoogleAccountNoticeEmail').mockResolvedValue(undefined);
  });

  it('emails an active password account a reset link', async () => {
    const user = await createUserFixture({ email: 'ada@example.test' });
    const response = await afterForgot('ADA@example.test');
    expect(response.status).toBe(202);
    expect(resetMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@example.test', name: user.name, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }));
  });

  it('tells a Google account to sign in with Google, and sends no link', async () => {
    await googleUser('g@example.test', 'g-1');
    await afterForgot('g@example.test');
    expect(googleMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'g@example.test' }));
    expect(resetMail).not.toHaveBeenCalled();
  });

  it('sends nothing for a suspended, retired or unknown account', async () => {
    await createUserFixture({ email: 'suspended@example.test', isActive: false });
    const retiring = await createUserFixture({ email: 'retired@example.test' });
    await retireAccount({ targetUserId: retiring._id, actorUserId: retiring._id });
    for (const email of ['suspended@example.test', 'retired@example.test', 'nobody@example.test']) await afterForgot(email);
    expect(resetMail).not.toHaveBeenCalled();
    expect(googleMail).not.toHaveBeenCalled();
  });

  it('answers byte for byte the same whatever the account state', async () => {
    await createUserFixture({ email: 'active@example.test' });
    await googleUser('google@example.test', 'g-2');
    await createUserFixture({ email: 'suspended@example.test', isActive: false });
    const retiring = await createUserFixture({ email: 'retired@example.test' });
    await retireAccount({ targetUserId: retiring._id, actorUserId: retiring._id });
    const answers = [];
    for (const email of ['active@example.test', 'google@example.test', 'suspended@example.test', 'retired@example.test', 'nobody@example.test']) {
      const response = await afterForgot(email);
      answers.push({ status: response.status, text: response.text, headers: Object.keys(response.headers).filter((h) => !['date', 'x-request-id', 'etag'].includes(h)).sort() });
    }
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it('limits one address to 3 requests an hour, whether or not it has an account', async () => {
    for (let i = 0; i < 3; i += 1) expect((await afterForgot('nobody@example.test')).status).toBe(202);
    expect((await forgot('nobody@example.test')).status).toBe(429);
  });
});

describe('reset password', () => {
  const tokenFor = (user, now) => issueToken({ userId: user._id, purpose: 'password_reset', requestedBy: user._id, now });
  beforeEach(() => { vi.spyOn(emailService, 'sendPasswordChangedEmail').mockResolvedValue(undefined); });

  it('sets the new password, ends every session, and tells the account', async () => {
    const { agent, user } = await createAuthenticatedAgent();
    const response = await reset(await tokenFor(user), 'Brand-new-pass');
    expect(response.status).toBe(200);
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(0);
    expect((await agent.get('/api/v1/users/profile')).status).toBe(401);
    expect((await login(user.email, 'fixture-password')).status).toBe(401);
    expect((await login(user.email, 'Brand-new-pass')).status).toBe(200);
    await drainOutbox();
    expect(emailService.sendPasswordChangedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
  });

  it.each([
    ['used', async (user) => { const t = await tokenFor(user); await reset(t, 'Brand-new-pass'); return t; }],
    ['expired', (user) => tokenFor(user, new Date(Date.now() - 31 * 60 * 1000))],
    ['replaced', async (user) => { const t = await tokenFor(user); await tokenFor(user); return t; }],
    ['unknown', () => 'x'.repeat(43)],
  ])('refuses a %s link with one code', async (_label, makeToken) => {
    const user = await createUserFixture();
    const response = await reset(await makeToken(user), 'Another-pass-1');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('refuses the email as the password and leaves the link usable', async () => {
    const user = await createUserFixture({ email: 'same@example.test' });
    const token = await tokenFor(user);
    expect((await reset(token, 'same@example.test')).body.error.code).toBe('PASSWORD_REJECTED');
    expect((await reset(token, 'Brand-new-pass')).status).toBe(200);
  });

  it('refuses a link once the account is suspended', async () => {
    const user = await createUserFixture();
    const token = await tokenFor(user);
    await User.updateOne({ _id: user._id }, { isActive: false });
    expect((await reset(token, 'Brand-new-pass')).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('clears the sign-in lockout for the account', async () => {
    const user = await createUserFixture();
    for (let i = 0; i < 5; i += 1) await login(user.email, 'wrong-password');
    expect((await login(user.email, 'fixture-password')).status).toBe(429);
    await reset(await tokenFor(user), 'Brand-new-pass');
    expect((await login(user.email, 'Brand-new-pass')).status).toBe(200);
  });
});
