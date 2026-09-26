const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');
const { AccountToken, OutboxEntry, User } = require('../../models');
const emailService = require('../../services/emailService');
const { JobError } = require('../../services/jobs/jobError');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { drainOutbox } = require('../helpers/jobs');
const { captureLogs } = require('../helpers/captureLogs');

const forgot = (email) => unsafeRequest(request(testServer()), 'post', '/api/v1/auth/password/forgot').send({ email });
const googleUser = (email, googleId) => createUserFixture({ email, authProvider: 'google', googleId, password: undefined });
const queueReset = (email) => inTransaction((session) => enqueue(session, { queue: 'email', type: 'password_reset_request', refs: { email } }));

describe('account emails', () => {
  beforeEach(() => {
    vi.spyOn(emailService, 'sendPasswordResetEmail').mockResolvedValue(undefined);
    vi.spyOn(emailService, 'sendGoogleAccountNoticeEmail').mockResolvedValue(undefined);
    vi.spyOn(emailService, 'sendPasswordChangedEmail').mockResolvedValue(undefined);
  });

  it('does the same work for every address in the request: one outbox entry, and nothing else', async () => {
    await createUserFixture({ email: 'local@example.test' });
    await googleUser('google@example.test', 'g-1');
    for (const email of ['local@example.test', 'google@example.test', 'nobody@example.test']) {
      expect((await forgot(email)).status).toBe(202);
    }
    expect((await OutboxEntry.find().sort({ createdAt: 1, _id: 1 })).map((entry) => [entry.type, entry.refs.email]))
      .toEqual([['password_reset_request', 'local@example.test'], ['password_reset_request', 'google@example.test'], ['password_reset_request', 'nobody@example.test']]);
    expect(await AccountToken.countDocuments()).toBe(0);
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('makes the link at send time, with its record id as the idempotency key, and forgets the address', async () => {
    const user = await createUserFixture({ email: 'local@example.test' });
    await forgot('local@example.test');
    await drainOutbox();
    const [record] = await AccountToken.find({ user: user._id, purpose: 'password_reset' });
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'local@example.test', token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), idempotencyKey: `link-${record._id}`,
    }));
    const [entry] = await OutboxEntry.find();
    expect(entry.state).toBe('DONE');
    expect(entry.refs).toEqual({});
  });

  it('tells a Google account, and does nothing for an unknown, suspended or retired one', async () => {
    await googleUser('google@example.test', 'g-2');
    await createUserFixture({ email: 'suspended@example.test', isActive: false });
    await createUserFixture({ email: 'retired@example.test', retiredAt: new Date(), isActive: false });
    for (const email of ['google@example.test', 'nobody@example.test', 'suspended@example.test', 'retired@example.test']) await forgot(email);
    await drainOutbox();
    expect(emailService.sendGoogleAccountNoticeEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await AccountToken.countDocuments()).toBe(0);
  });

  it('sends at most 3 link emails an hour to one address, and says so without the address', async () => {
    await createUserFixture({ email: 'capped@example.test' });
    for (let i = 0; i < 4; i += 1) await queueReset('capped@example.test');
    const logs = captureLogs();
    try { await drainOutbox(); } finally { logs.restore(); }
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(3);
    expect(logs.lines.filter((line) => line.event === 'recipient_capped')).toHaveLength(1);
    expect(logs.text()).not.toContain('capped@example.test');
  });

  it('counts a request once against the cap, however many attempts it takes', async () => {
    await createUserFixture({ email: 'retry@example.test' });
    emailService.sendPasswordResetEmail
      .mockRejectedValueOnce(JobError.of('PROVIDER_DOWN'))
      .mockRejectedValueOnce(JobError.of('PROVIDER_DOWN'))
      .mockRejectedValueOnce(JobError.of('PROVIDER_DOWN'));
    await queueReset('retry@example.test');
    await drainOutbox({ maxAttempts: 4 });
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(4);
    expect(await OutboxEntry.findOne()).toMatchObject({ state: 'DONE', attempts: 4 });
    // The first attempt's link was replaced by each retry's: one usable link remains.
    expect(await AccountToken.countDocuments({ usedAt: null })).toBe(1);
  });

  it('forgets the address when a request fails for good', async () => {
    await createUserFixture({ email: 'failing@example.test' });
    emailService.sendPasswordResetEmail.mockRejectedValue(JobError.of('REJECTED'));
    await queueReset('failing@example.test');
    await drainOutbox();
    const entry = await OutboxEntry.findOne();
    expect(entry).toMatchObject({ state: 'FAILED', lastErrorCode: 'REJECTED' });
    expect(entry.refs).toEqual({});
  });

  it('sends no reset link to an address the account stopped using before the job ran', async () => {
    const user = await createUserFixture({ email: 'old@example.test' });
    await forgot('old@example.test');
    await User.updateOne({ _id: user._id }, { email: 'new@example.test' });
    await drainOutbox();
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await AccountToken.countDocuments()).toBe(0);
  });

  it('queues the password-changed email with the change, and none when the change fails', async () => {
    const { agent, user, password } = await createAuthenticatedAgent();
    const change = (body) => unsafeRequest(agent, 'post', '/api/v1/users/profile/password').send(body);
    expect((await change({ currentPassword: 'wrong-pass-1', newPassword: 'Brand-new-pass-1' })).status).toBe(401);
    expect(await OutboxEntry.countDocuments()).toBe(0);
    expect((await change({ currentPassword: password, newPassword: 'Brand-new-pass-1' })).status).toBe(200);
    expect(await OutboxEntry.find()).toEqual([expect.objectContaining({ type: 'password_changed', refs: { userId: String(user._id) } })]);
    await drainOutbox();
    expect(emailService.sendPasswordChangedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email, idempotencyKey: expect.stringMatching(/^email-/) }));
  });
});
