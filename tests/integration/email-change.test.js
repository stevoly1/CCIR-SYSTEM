const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createGoogleAgent } = require('../helpers/googleAuth');
const { createUserFixture } = require('../fixtures/user');
const { AccountToken, RefreshToken, User } = require('../../models');
const emailService = require('../../services/emailService');
const { issueToken, consumeToken } = require('../../services/accountTokenService');
const { retireAccount } = require('../../services/accountRetirementService');
const { captureLogs } = require('../helpers/captureLogs');

const api = () => request(testServer());
const ownChange = (agent, body) => unsafeRequest(agent, 'post', '/api/v1/users/profile/email').send(body);
const adminChange = (agent, id, body) => unsafeRequest(agent, 'post', `/api/v1/users/${id}/email`).send(body);
const confirm = (token) => unsafeRequest(api(), 'post', '/api/v1/auth/email/confirm').send({ token });
const sentToken = () => emailService.sendEmailChangeConfirmation.mock.calls.at(-1)[0].token;

describe('email change', () => {
  beforeEach(() => {
    vi.spyOn(emailService, 'sendEmailChangeConfirmation').mockResolvedValue(true);
    vi.spyOn(emailService, 'sendEmailChangeNotice').mockResolvedValue(true);
  });

  it('confirms at the new address, tells the old one, and changes nothing until confirmed', async () => {
    const { agent, user, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    const response = await ownChange(agent, { newEmail: 'New@Example.test', currentPassword: password });
    expect(response.status).toBe(202);
    expect(emailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.test' }));
    await vi.waitFor(() => expect(emailService.sendEmailChangeNotice).toHaveBeenCalledWith(expect.objectContaining({ to: 'old@example.test', newEmail: 'new@example.test' })));
    expect((await User.findById(user._id)).email).toBe('old@example.test');
  });

  it('applies the change on confirmation, keeps sessions, and cancels reset links sent to the old address', async () => {
    const { agent, user, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    const reset = await issueToken({ userId: user._id, purpose: 'password_reset', requestedBy: user._id });
    await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    const response = await confirm(sentToken());
    expect(response.status).toBe(200);
    expect((await User.findById(user._id)).email).toBe('new@example.test');
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(1);
    expect(await consumeToken({ token: reset, purpose: 'password_reset' })).toBeNull();
    expect((await confirm(sentToken())).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it.each([
    ['a wrong password', () => ({ newEmail: 'x@example.test', currentPassword: 'wrong-password' }), 401, 'WRONG_PASSWORD'],
    ['the same address', (user) => ({ newEmail: user.email, currentPassword: 'fixture-password' }), 400, 'SAME_EMAIL'],
    ['an address in use', () => ({ newEmail: 'taken@example.test', currentPassword: 'fixture-password' }), 409, 'CONFLICT'],
  ])('refuses %s', async (_label, body, status, code) => {
    await createUserFixture({ email: 'taken@example.test' });
    const { agent, user } = await createAuthenticatedAgent();
    const response = await ownChange(agent, body(user));
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
  });

  it('refuses a Google account', async () => {
    const { agent } = await createGoogleAgent();
    const response = await ownChange(agent, { newEmail: 'x@example.test', currentPassword: 'anything' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GOOGLE_ACCOUNT');
  });

  it('answers 503 and keeps no link when the confirmation cannot be sent', async () => {
    emailService.sendEmailChangeConfirmation.mockResolvedValue(false);
    const { agent, user, password } = await createAuthenticatedAgent();
    const response = await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('EMAIL_NOT_SENT');
    expect(await AccountToken.countDocuments({ user: user._id })).toBe(0);
  });

  it('answers 503 and keeps no link when the old address cannot be told', async () => {
    emailService.sendEmailChangeNotice.mockResolvedValue(false);
    const { agent, user, password } = await createAuthenticatedAgent();
    const response = await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('EMAIL_NOT_SENT');
    expect(await AccountToken.countDocuments({ user: user._id })).toBe(0);
  });

  it('tells the old address before answering, as the person themselves', async () => {
    const { agent, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    expect(emailService.sendEmailChangeNotice).toHaveBeenCalledWith(expect.objectContaining({ to: 'old@example.test', requestedByAdministrator: false }));
  });

  it('limits an account to 5 requests an hour', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    for (let i = 0; i < 5; i += 1) expect((await ownChange(agent, { newEmail: `n${i}@example.test`, currentPassword: password })).status).toBe(202);
    expect((await ownChange(agent, { newEmail: 'n6@example.test', currentPassword: password })).status).toBe(429);
  });

  it('counts refused addresses against the hourly limit, so it cannot probe which addresses have accounts', async () => {
    await createUserFixture({ email: 'taken@example.test' });
    const { agent, password } = await createAuthenticatedAgent();
    for (let i = 0; i < 5; i += 1) expect((await ownChange(agent, { newEmail: 'taken@example.test', currentPassword: password })).status).toBe(409);
    expect((await ownChange(agent, { newEmail: 'taken@example.test', currentPassword: password })).status).toBe(429);
  });

  it('refuses a confirmation when the address was taken in the meantime', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    await ownChange(agent, { newEmail: 'wanted@example.test', currentPassword: password });
    const token = sentToken();
    await createUserFixture({ email: 'wanted@example.test' });
    const response = await confirm(token);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('refuses a confirmation for an account retired since the request', async () => {
    const other = await createUserFixture();
    const token = await issueToken({ userId: other._id, purpose: 'email_change', newEmail: 'free@example.test', requestedBy: other._id });
    await retireAccount({ targetUserId: other._id, actorUserId: other._id });
    const response = await confirm(token);
    expect(response.status).toBe(400); // retirement cancelled the link
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });
});

describe('administrator email change', () => {
  beforeEach(() => {
    vi.spyOn(emailService, 'sendEmailChangeConfirmation').mockResolvedValue(true);
    vi.spyOn(emailService, 'sendEmailChangeNotice').mockResolvedValue(true);
  });

  it('sends the confirmation to the new address; the user confirms signed out', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture({ email: 'typo@exmaple.test' });
    expect((await adminChange(admin, target.id, { newEmail: 'right@example.test' })).status).toBe(202);
    expect((await User.findById(target.id)).email).toBe('typo@exmaple.test');
    await vi.waitFor(() => expect(emailService.sendEmailChangeNotice).toHaveBeenCalledWith(expect.objectContaining({ to: 'typo@exmaple.test' })));
    expect((await confirm(sentToken())).status).toBe(200);
    expect((await User.findById(target.id)).email).toBe('right@example.test');
  });

  it('tells the old address that an administrator asked, and logs which administrator and which account', async () => {
    const logs = captureLogs();
    try {
      const { agent: admin, user: administrator } = await createAuthenticatedAgent({ role: 'admin' });
      const target = await createUserFixture({ email: 'typo@exmaple.test' });
      expect((await adminChange(admin, target.id, { newEmail: 'right@example.test' })).status).toBe(202);
      expect(emailService.sendEmailChangeNotice).toHaveBeenCalledWith(expect.objectContaining({ to: 'typo@exmaple.test', requestedByAdministrator: true }));
      const line = logs.lines.find((entry) => entry.event === 'email_change_requested');
      expect(line).toMatchObject({ userId: target.id, requestedBy: String(administrator._id) });
      expect(logs.text()).not.toContain('right@example.test');
      expect(logs.text()).not.toContain('typo@exmaple.test');
    } finally {
      logs.restore();
    }
  });

  it('answers 503 and keeps no link when the old address cannot be told', async () => {
    emailService.sendEmailChangeNotice.mockResolvedValue(false);
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture();
    const response = await adminChange(admin, target.id, { newEmail: 'right@example.test' });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('EMAIL_NOT_SENT');
    expect(await AccountToken.countDocuments({ user: target._id })).toBe(0);
  });

  it.each([['a citizen', 'citizen'], ['an agency user', 'agency']])('refuses %s', async (_label, role) => {
    const { agent } = await createAuthenticatedAgent({ role });
    const target = await createUserFixture();
    expect((await adminChange(agent, target.id, { newEmail: 'x@example.test' })).status).toBe(403);
  });

  it('sends administrators to their profile for their own address', async () => {
    const { agent: admin, user } = await createAuthenticatedAgent({ role: 'admin' });
    const response = await adminChange(admin, user.id, { newEmail: 'x@example.test' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('USE_PROFILE');
  });

  it('refuses a retired account, a Google account, and an unknown one', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const retired = await createUserFixture();
    await retireAccount({ targetUserId: retired._id, actorUserId: retired._id });
    expect((await adminChange(admin, retired.id, { newEmail: 'x@example.test' })).status).toBe(409);
    const google = await createUserFixture({ authProvider: 'google', googleId: 'g-admin-1', password: undefined });
    expect((await adminChange(admin, google.id, { newEmail: 'x@example.test' })).body.error.code).toBe('GOOGLE_ACCOUNT');
    expect((await adminChange(admin, '0123456789abcdef01234567', { newEmail: 'x@example.test' })).status).toBe(404);
  });

  it('no longer changes an email through the edit endpoint', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture({ email: 'stay@example.test' });
    const response = await unsafeRequest(admin, 'patch', `/api/v1/users/${target.id}`).send({ email: 'moved@example.test' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((await User.findById(target.id)).email).toBe('stay@example.test');
  });
});
