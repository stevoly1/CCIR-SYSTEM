const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createGoogleAgent } = require('../helpers/googleAuth');
const { createUserFixture } = require('../fixtures/user');
const { AccountToken, EmailChange, OutboxEntry, RefreshToken, User } = require('../../models');
const emailService = require('../../services/emailService');
const { issueToken, consumeToken } = require('../../services/accountTokenService');
const { retireAccount } = require('../../services/accountRetirementService');
const { executeEntry } = require('../../services/jobs/execute');
const registry = require('../../services/jobs/registry');
const { JobError } = require('../../services/jobs/jobError');
const { drainOutbox } = require('../helpers/jobs');
const { captureLogs } = require('../helpers/captureLogs');

const api = () => request(testServer());
const ownChange = (agent, body) => unsafeRequest(agent, 'post', '/api/v1/users/profile/email').send(body);
const adminChange = (agent, id, body) => unsafeRequest(agent, 'post', `/api/v1/users/${id}/email`).send(body);
const confirm = (token) => unsafeRequest(api(), 'post', '/api/v1/auth/email/confirm').send({ token });
const linkToken = () => emailService.sendEmailChangeConfirmation.mock.calls.at(-1)[0].token;
const drainOutboxFor = async (changeId) => {
  for (const type of ['email_change_notice', 'email_change_link']) {
    await executeOne(await OutboxEntry.findOne({ type, 'refs.emailChangeId': changeId }));
  }
};
const executeOne = (entry) => executeEntry(entry._id, { runKey: entry.runKey, attempt: entry.attempts + 1, maxAttempts: 1 });

beforeEach(() => {
  vi.spyOn(emailService, 'sendEmailChangeNotice').mockResolvedValue(undefined);
  vi.spyOn(emailService, 'sendEmailChangeConfirmation').mockResolvedValue(undefined);
});

describe('email change as a state machine', () => {
  it('answers 202 at once, and changes nothing yet', async () => {
    const { agent, user, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    const response = await ownChange(agent, { newEmail: 'New@Example.test', currentPassword: password });
    expect(response.status).toBe(202);
    expect(response.body.pendingEmailChange).toEqual({ newEmail: 'new@example.test', state: 'NOTICE_PENDING' });
    expect(emailService.sendEmailChangeNotice).not.toHaveBeenCalled();
    expect((await User.findById(user._id)).email).toBe('old@example.test');
    expect((await agent.get('/api/v1/users/profile')).body.user.pendingEmailChange).toEqual({ newEmail: 'new@example.test', state: 'NOTICE_PENDING' });
  });

  it('sends the link only after the old address is told, and the link works only then', async () => {
    const { agent, user, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    const reset = await issueToken({ userId: user._id, purpose: 'password_reset', requestedBy: user._id });
    await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    // First pass: only the notice job exists, and it queues the link job when it succeeds.
    const [notice] = await OutboxEntry.find();
    expect(notice.type).toBe('email_change_notice');
    await executeOne(notice);
    expect(emailService.sendEmailChangeNotice).toHaveBeenCalledWith(expect.objectContaining({ to: 'old@example.test', newEmail: 'new@example.test', requestedByAdministrator: false }));
    expect(emailService.sendEmailChangeConfirmation).not.toHaveBeenCalled();
    expect(await AccountToken.countDocuments({ purpose: 'email_change' })).toBe(0);
    expect((await EmailChange.findOne()).state).toBe('NOTICE_SENT');
    await drainOutbox();
    expect((await EmailChange.findOne()).state).toBe('LINK_SENT');
    expect(emailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.test' }));
    expect((await agent.get('/api/v1/users/profile')).body.user.pendingEmailChange).toEqual({ newEmail: 'new@example.test', state: 'LINK_SENT' });

    const response = await confirm(linkToken());
    expect(response.status).toBe(200);
    expect((await User.findById(user._id)).email).toBe('new@example.test');
    expect((await EmailChange.findOne()).state).toBe('CONFIRMED');
    // Sessions stay; reset links sent to the old address do not; the link works once.
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(1);
    expect(await consumeToken({ token: reset, purpose: 'password_reset' })).toBeNull();
    expect((await confirm(linkToken())).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await agent.get('/api/v1/users/profile')).body.user.pendingEmailChange).toBeNull();
  });

  it('accepts a link used between its sending and the change being marked sent', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    await ownChange(agent, { newEmail: 'quick@example.test', currentPassword: password });
    await drainOutbox();
    await EmailChange.updateOne({}, { state: 'NOTICE_SENT' });
    expect((await confirm(linkToken())).status).toBe(200);
  });

  it.each([
    ['the notice', 'sendEmailChangeNotice'],
    ['the link', 'sendEmailChangeConfirmation'],
  ])('fails the change, keeps no link and changes nothing when %s cannot be sent', async (_label, send) => {
    emailService[send].mockRejectedValue(JobError.of('REJECTED'));
    const { agent, user, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    await drainOutbox();
    expect(await EmailChange.findOne()).toMatchObject({ state: 'FAILED', failedCode: 'REJECTED' });
    expect(await AccountToken.countDocuments({ purpose: 'email_change', usedAt: null })).toBe(0);
    expect((await User.findById(user._id)).email).toBe('old@example.test');
    const profile = await agent.get('/api/v1/users/profile');
    expect(profile.body.user.pendingEmailChange).toEqual({ newEmail: 'new@example.test', state: 'FAILED' });
  });

  it('fails the change, visibly, when the new address already had three link emails this hour', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    const others = await Promise.all([1, 2, 3].map(() => createAuthenticatedAgent()));
    for (const other of others) {
      await ownChange(other.agent, { newEmail: 'popular@example.test', currentPassword: other.password });
    }
    await drainOutbox();
    await ownChange(agent, { newEmail: 'popular@example.test', currentPassword: password });
    await drainOutbox();
    expect((await EmailChange.find().sort({ createdAt: 1 })).map((change) => change.state)).toEqual(['LINK_SENT', 'LINK_SENT', 'LINK_SENT', 'FAILED']);
    expect((await EmailChange.findOne().sort({ createdAt: -1 })).failedCode).toBe('RECIPIENT_CAPPED');
  });

  it('lets a newer request replace an unfinished one', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    await ownChange(agent, { newEmail: 'first@example.test', currentPassword: password });
    await drainOutbox();
    const first = linkToken();
    await ownChange(agent, { newEmail: 'second@example.test', currentPassword: password });
    expect((await EmailChange.find().sort({ createdAt: 1 })).map((change) => change.state)).toEqual(['SUPERSEDED', 'NOTICE_PENDING']);
    expect((await confirm(first)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('cancels a pending change when the account is suspended, and its link stops working', async () => {
    const { agent, user, password } = await createAuthenticatedAgent();
    await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    await drainOutbox();
    const token = linkToken();
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    expect((await unsafeRequest(admin, 'patch', `/api/v1/users/${user._id}`).send({ isActive: false })).status).toBe(200);
    expect((await EmailChange.findOne()).state).toBe('CANCELLED');
    expect((await confirm(token)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('cancels a pending change when the password changes', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    await drainOutbox();
    const token = linkToken();
    expect((await unsafeRequest(agent, 'post', '/api/v1/users/profile/password').send({ currentPassword: password, newPassword: 'Brand-new-pass-1' })).status).toBe(200);
    expect((await EmailChange.findOne()).state).toBe('CANCELLED');
    expect((await confirm(token)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('removes used links and changes when the account retires', async () => {
    const { agent, user, password } = await createAuthenticatedAgent();
    await ownChange(agent, { newEmail: 'new@example.test', currentPassword: password });
    await drainOutbox();
    await confirm(linkToken());
    await retireAccount({ targetUserId: user._id, actorUserId: (await createUserFixture({ role: 'admin' }))._id });
    expect(await AccountToken.countDocuments({ user: user._id })).toBe(0);
    expect(await EmailChange.countDocuments({ user: user._id })).toBe(0);
  });

  it('refuses a confirmation when the address was taken in the meantime', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    await ownChange(agent, { newEmail: 'wanted@example.test', currentPassword: password });
    await drainOutbox();
    await createUserFixture({ email: 'wanted@example.test' });
    const response = await confirm(linkToken());
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('refuses a link that belongs to no email change', async () => {
    const other = await createUserFixture();
    const token = await issueToken({ userId: other._id, purpose: 'email_change', newEmail: 'free@example.test', requestedBy: other._id });
    const response = await confirm(token);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });
});

describe('email change requests', () => {
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
    expect(await EmailChange.countDocuments()).toBe(0);
  });

  it('refuses a Google account', async () => {
    const { agent } = await createGoogleAgent();
    const response = await ownChange(agent, { newEmail: 'x@example.test', currentPassword: 'anything' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GOOGLE_ACCOUNT');
  });

  it('limits an account to 5 requests an hour', async () => {
    const { agent, password } = await createAuthenticatedAgent();
    for (let i = 0; i < 5; i += 1) expect((await ownChange(agent, { newEmail: `n${i}@example.test`, currentPassword: password })).status).toBe(202);
    expect((await ownChange(agent, { newEmail: 'n6@example.test', currentPassword: password })).status).toBe(429);
    expect(await EmailChange.countDocuments({ active: true })).toBe(1);
  });

  it('counts refused addresses against the hourly limit, so it cannot probe which addresses have accounts', async () => {
    await createUserFixture({ email: 'taken@example.test' });
    const { agent, password } = await createAuthenticatedAgent();
    for (let i = 0; i < 5; i += 1) expect((await ownChange(agent, { newEmail: 'taken@example.test', currentPassword: password })).status).toBe(409);
    expect((await ownChange(agent, { newEmail: 'taken@example.test', currentPassword: password })).status).toBe(429);
  });
});

describe('a link job that read its change just before a newer request replaced it', () => {
  it('sends no link, and leaves the newer change\'s link alone', async () => {
    const { agent, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    await ownChange(agent, { newEmail: 'first@example.test', currentPassword: password });
    const older = await EmailChange.findOne({ newEmail: 'first@example.test' });
    await executeOne(await OutboxEntry.findOne({ type: 'email_change_notice', 'refs.emailChangeId': older.id }));
    const olderLink = await OutboxEntry.findOne({ type: 'email_change_link', 'refs.emailChangeId': older.id });
    const staleOlder = await EmailChange.findById(older.id);
    expect(staleOlder).toMatchObject({ state: 'NOTICE_SENT', active: true });

    await ownChange(agent, { newEmail: 'second@example.test', currentPassword: password });
    const newer = await EmailChange.findOne({ newEmail: 'second@example.test' });
    await drainOutboxFor(newer.id);
    expect(await EmailChange.findById(newer.id)).toMatchObject({ state: 'LINK_SENT' });
    const sent = emailService.sendEmailChangeConfirmation.mock.calls.length;

    // The older job read its change while it was still under way.
    vi.spyOn(EmailChange, 'findById').mockResolvedValueOnce(staleOlder);
    await executeOne(olderLink);
    expect(emailService.sendEmailChangeConfirmation.mock.calls.slice(sent).map(([args]) => args.to)).toEqual([]);
    expect(await AccountToken.countDocuments({ emailChange: newer.id, usedAt: null })).toBe(1);
  });
});

describe('a second, concurrent run of the same link job', () => {
  it('leaves the change the first run completed, and its link working', async () => {
    const { agent, password } = await createAuthenticatedAgent({ email: 'old@example.test' });
    await ownChange(agent, { newEmail: 'dup@example.test', currentPassword: password });
    const change = await EmailChange.findOne({ newEmail: 'dup@example.test' });
    await executeOne(await OutboxEntry.findOne({ type: 'email_change_notice' }));
    const linkEntry = await OutboxEntry.findOne({ type: 'email_change_link' });
    const staleChange = await EmailChange.findById(change._id);
    await executeOne(linkEntry); // the first run: link sent, change LINK_SENT
    const firstLink = linkToken();

    // The duplicate read the entry and the change before the first run recorded anything.
    vi.spyOn(EmailChange, 'findById').mockResolvedValueOnce(staleChange);
    await registry.handlerFor('email_change_link').run(linkEntry);
    expect(await EmailChange.findById(change._id)).toMatchObject({ state: 'LINK_SENT', active: true });
    expect((await confirm(firstLink)).status).toBe(200);
  });
});

describe('administrator email change', () => {
  it('sends the confirmation to the new address; the user confirms signed out', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture({ email: 'typo@exmaple.test' });
    const response = await adminChange(admin, target.id, { newEmail: 'right@example.test' });
    expect(response.status).toBe(202);
    expect(response.body.pendingEmailChange).toEqual({ newEmail: 'right@example.test', state: 'NOTICE_PENDING' });
    expect((await User.findById(target.id)).email).toBe('typo@exmaple.test');
    const list = await admin.get('/api/v1/users').query({ search: 'typo@exmaple' });
    expect(list.body.users[0].pendingEmailChange).toEqual({ newEmail: 'right@example.test', state: 'NOTICE_PENDING' });
    await drainOutbox();
    expect(emailService.sendEmailChangeNotice).toHaveBeenCalledWith(expect.objectContaining({ to: 'typo@exmaple.test' }));
    expect((await confirm(linkToken())).status).toBe(200);
    expect((await User.findById(target.id)).email).toBe('right@example.test');
  });

  it('names an administrator in the notice, and logs both ids from the job', async () => {
    const target = await createUserFixture({ email: 'target@example.test' });
    const { agent: admin, user: adminUser } = await createAuthenticatedAgent({ role: 'admin' });
    expect((await adminChange(admin, target._id, { newEmail: 'fixed@example.test' })).status).toBe(202);
    const logs = captureLogs();
    try { await drainOutbox(); } finally { logs.restore(); }
    expect(emailService.sendEmailChangeNotice).toHaveBeenCalledWith(expect.objectContaining({ requestedByAdministrator: true }));
    expect(logs.lines).toContainEqual(expect.objectContaining({ event: 'email_change_requested', userId: String(target._id), requestedBy: String(adminUser._id) }));
    expect(logs.text()).not.toContain('fixed@example.test');
    expect(logs.text()).not.toContain('target@example.test');
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
