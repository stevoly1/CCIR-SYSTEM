const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createGoogleAgent } = require('../helpers/googleAuth');
const { createUserFixture } = require('../fixtures/user');
const { createCategoryFixture } = require('../fixtures/category');
const { AccountToken, Complaint, OutboxEntry, User } = require('../../models');
const emailService = require('../../services/emailService');
const aiService = require('../../services/aiService');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { drainOutbox } = require('../helpers/jobs');

const api = () => request(testServer());
const verify = (token) => unsafeRequest(api(), 'post', '/api/v1/auth/email/verify').send({ token });
const sentToken = () => emailService.sendVerificationEmail.mock.calls.at(-1)[0].token;
const signUp = (agent, email = 'new.person@example.test') => unsafeRequest(agent, 'post', '/api/v1/auth/signup').send({ name: 'New Person', email, password: 'Example-pass-1' });
const file = (agent) => unsafeRequest(agent, 'post', '/api/v1/complaints').send({ description: 'Blocked drain beside the market gate', address: '12 Market Road, Ikeja' });

describe('email verification', () => {
  beforeEach(async () => {
    vi.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(undefined);
    vi.spyOn(emailService, 'sendComplaintFiledEmail').mockResolvedValue(undefined);
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue({ category: 'Other', priority: 'LOW', summary: 's', tags: [], confidence: 0.9, error: null });
    await createCategoryFixture({ name: 'Other' });
  });

  it('queues a link with the new account, and verifies once', async () => {
    const agent = request.agent(testServer());
    const response = await signUp(agent);
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ emailVerified: false, emailVerifiedAt: null });
    expect(await OutboxEntry.find()).toEqual([expect.objectContaining({ type: 'verify_email' })]);
    await drainOutbox();
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new.person@example.test', idempotencyKey: expect.stringMatching(/^link-/),
    }));
    const token = sentToken();
    expect((await verify(token)).status).toBe(200);
    expect((await agent.get('/api/v1/users/profile')).body.user.emailVerified).toBe(true);
    expect((await verify(token)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('keeps no account and no job when sign-up fails', async () => {
    await createUserFixture({ email: 'taken@example.test' });
    expect((await signUp(request.agent(testServer()), 'taken@example.test')).status).toBe(409);
    expect(await OutboxEntry.countDocuments()).toBe(0);
  });

  it('answers a sign-up that loses a race for the address as a conflict, with no job', async () => {
    const findOne = vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    await createUserFixture({ email: 'raced@example.test' });
    const response = await signUp(request.agent(testServer()), 'raced@example.test');
    findOne.mockRestore();
    expect(response.status).toBe(409);
    expect(await OutboxEntry.countDocuments()).toBe(0);
  });

  it('refuses filing until verified, then accepts it', async () => {
    const { agent, user } = await createAuthenticatedAgent({ emailVerifiedAt: null });
    const refused = await file(agent);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await Complaint.countDocuments()).toBe(0);
    await User.updateOne({ _id: user._id }, { emailVerifiedAt: new Date() });
    expect((await file(agent)).status).toBe(201);
  });

  it('sends a fresh link on request, at most 3 an hour, and refuses when already verified', async () => {
    const { agent } = await createAuthenticatedAgent({ emailVerifiedAt: null });
    const resend = () => unsafeRequest(agent, 'post', '/api/v1/users/profile/verification-email').send({});
    for (let i = 0; i < 3; i += 1) expect((await resend()).status).toBe(202);
    expect((await resend()).status).toBe(429);
    expect(await OutboxEntry.countDocuments({ type: 'verify_email' })).toBe(3);
    await drainOutbox();
    // Each link replaces the one before it.
    expect(await AccountToken.countDocuments({ purpose: 'email_verify', usedAt: null })).toBe(1);

    const { agent: verified } = await createAuthenticatedAgent();
    const already = await unsafeRequest(verified, 'post', '/api/v1/users/profile/verification-email').send({});
    expect(already.status).toBe(409);
    expect(already.body.error.code).toBe('ALREADY_VERIFIED');
  });

  it('treats Google accounts as verified', async () => {
    const { agent } = await createGoogleAgent();
    const { user } = (await agent.get('/api/v1/users/profile')).body;
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifiedAt).toEqual(expect.any(String));
  });

  it('refuses a staff role for an unverified account, and allows it once verified', async () => {
    const target = await createUserFixture({ emailVerifiedAt: null });
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const promote = () => unsafeRequest(admin, 'patch', `/api/v1/users/${target._id}`).send({ role: 'agency' });
    const response = await promote();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await User.findById(target._id)).role).toBe('citizen');
    await User.updateOne({ _id: target._id }, { emailVerifiedAt: new Date() });
    expect((await promote()).status).toBe(200);
  });

  it('sends no report email to an unverified address', async () => {
    const reporter = await createUserFixture({ emailVerifiedAt: null });
    // An older report, from before verification existed.
    const other = await createCategoryFixture({ name: 'Older' });
    const complaint = await Complaint.create({ referenceCode: 'CCIR-OLD00001', description: 'Old report from before verification', category: other._id, categorySnapshot: { categoryId: other._id, name: 'Older' }, reporter: reporter._id, location: { address: '1 Old Road' } });
    await inTransaction((session) => enqueue(session, { queue: 'email', type: 'report_filed', refs: { complaintId: String(complaint._id) } }));
    await drainOutbox();
    expect(emailService.sendComplaintFiledEmail).not.toHaveBeenCalled();
  });

  it('does not verify an address the account no longer uses', async () => {
    const agent = request.agent(testServer());
    await signUp(agent, 'first@example.test');
    await drainOutbox();
    const token = sentToken();
    await User.updateOne({ email: 'first@example.test' }, { email: 'second@example.test' });
    expect((await verify(token)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await User.findOne({ email: 'second@example.test' })).emailVerifiedAt).toBeNull();
  });

  it('verifies the new address when an email change is confirmed', async () => {
    vi.spyOn(emailService, 'sendEmailChangeNotice').mockResolvedValue(undefined);
    const confirmation = vi.spyOn(emailService, 'sendEmailChangeConfirmation').mockResolvedValue(undefined);
    const { agent, user, password } = await createAuthenticatedAgent({ emailVerifiedAt: null });
    await unsafeRequest(agent, 'post', '/api/v1/users/profile/email').send({ newEmail: 'proved@example.test', currentPassword: password });
    await drainOutbox();
    const { token } = confirmation.mock.calls.at(-1)[0];
    expect((await unsafeRequest(api(), 'post', '/api/v1/auth/email/confirm').send({ token })).status).toBe(200);
    expect((await User.findById(user._id)).emailVerifiedAt).toBeInstanceOf(Date);
  });
});
