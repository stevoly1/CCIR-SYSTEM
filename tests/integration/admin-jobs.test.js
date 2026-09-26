const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');
const { EmailChange, OutboxEntry } = require('../../models');
const emailService = require('../../services/emailService');
const { JobError } = require('../../services/jobs/jobError');
const { inTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../services/jobs/outbox');
const { drainOutbox } = require('../helpers/jobs');
const { captureLogs } = require('../helpers/captureLogs');

const failedJob = async (type, refs) => {
  const entry = await inTransaction((session) => enqueue(session, { queue: 'email', type, refs }));
  await OutboxEntry.updateOne({ _id: entry._id }, { state: 'FAILED', attempts: 8, lastErrorCode: 'PROVIDER_DOWN', lastErrorAt: new Date() });
  return entry;
};

describe('Jobs API', () => {
  let admin;
  let adminUser;
  beforeEach(async () => { ({ agent: admin, user: adminUser } = await createAuthenticatedAgent({ role: 'admin' })); });
  const retry = (id) => unsafeRequest(admin, 'post', `/api/v1/admin/jobs/${id}/retry`).send({});

  it('is for administrators only', async () => {
    const { agent: agency } = await createAuthenticatedAgent({ role: 'agency' });
    expect((await agency.get('/api/v1/admin/jobs')).status).toBe(403);
    expect((await request(testServer()).get('/api/v1/admin/jobs')).status).toBe(401);
  });

  it('lists failed jobs with a label, never an address', async () => {
    const person = await createUserFixture({ name: 'Pat Person', email: 'pat@example.test' });
    await failedJob('password_changed', { userId: String(person._id) });
    await failedJob('password_reset_request', { email: 'secret@example.test' });
    await failedJob('status_update', { complaintId: '0123456789abcdef01234567', historyEntryId: '0123456789abcdef01234568' });
    const response = await admin.get('/api/v1/admin/jobs?state=FAILED');
    expect(response.status).toBe(200);
    expect(response.body.jobs.map((job) => [job.type, job.subject.label, job.lastErrorCode])).toEqual(expect.arrayContaining([
      ['password_changed', 'Pat Person', 'PROVIDER_DOWN'],
      ['password_reset_request', 'Password reset request', 'PROVIDER_DOWN'],
      ['status_update', 'Deleted report', 'PROVIDER_DOWN'],
    ]));
    expect(response.body.pagination).toMatchObject({ page: 1, total: 3 });
    expect(JSON.stringify(response.body)).not.toMatch(/secret@example\.test|pat@example\.test/);
    expect((await admin.get('/api/v1/admin/jobs?state=DONE')).body.jobs).toEqual([]);
  });

  it('summarises the queues', async () => {
    await failedJob('password_changed', { userId: String((await createUserFixture())._id) });
    const response = await admin.get('/api/v1/admin/jobs/summary');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      queues: { email: { PENDING: 0, QUEUED: 0, FAILED: 1, DONE: 0, DISMISSED: 0 } }, oldestPendingSeconds: null, workerLastSeenSeconds: null,
    });
  });

  it('retries a failed job, which then runs, and logs who asked', async () => {
    vi.spyOn(emailService, 'sendPasswordChangedEmail').mockResolvedValue(undefined);
    const person = await createUserFixture();
    const entry = await failedJob('password_changed', { userId: String(person._id) });
    const logs = captureLogs();
    let response;
    try { response = await retry(entry._id); } finally { logs.restore(); }
    expect(response.status).toBe(200);
    expect(response.body.job).toMatchObject({ id: String(entry._id), state: 'PENDING', attempts: 0, lastErrorCode: null });
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ state: 'PENDING', runKey: 1, attempts: 0 });
    expect(logs.lines).toContainEqual(expect.objectContaining({ event: 'job_retried', entryId: String(entry._id), by: String(adminUser._id) }));
    await drainOutbox();
    expect(emailService.sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    const again = await retry(entry._id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('JOB_NOT_FAILED');
    expect((await retry('0123456789abcdef01234567')).status).toBe(404);
  });

  it('refuses to retry a password reset request whose address was already forgotten', async () => {
    const entry = await failedJob('password_reset_request', {});
    const response = await retry(entry._id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('JOB_CANNOT_RETRY');
    expect((await OutboxEntry.findById(entry._id)).state).toBe('FAILED');
  });

  it('answers a real failure as one, not as "cannot retry"', async () => {
    const entry = await failedJob('password_changed', { userId: String((await createUserFixture())._id) });
    vi.spyOn(OutboxEntry, 'updateOne').mockRejectedValueOnce(new Error('database gone'));
    expect((await retry(entry._id)).status).toBe(500);
    expect((await OutboxEntry.findById(entry._id)).state).toBe('FAILED');
  });

  it('reopens an email change on retry, unless a newer one is under way', async () => {
    vi.spyOn(emailService, 'sendEmailChangeNotice').mockRejectedValueOnce(JobError.of('REJECTED')).mockResolvedValue(undefined);
    vi.spyOn(emailService, 'sendEmailChangeConfirmation').mockResolvedValue(undefined);
    const { agent, password } = await createAuthenticatedAgent();
    await unsafeRequest(agent, 'post', '/api/v1/users/profile/email').send({ newEmail: 'moved@example.test', currentPassword: password });
    await drainOutbox();
    const [failed] = await OutboxEntry.find({ state: 'FAILED' });
    expect(await EmailChange.findOne()).toMatchObject({ state: 'FAILED' });
    expect((await retry(failed._id)).status).toBe(200);
    await drainOutbox();
    expect(await EmailChange.findOne()).toMatchObject({ state: 'LINK_SENT' });

    emailService.sendEmailChangeNotice.mockRejectedValueOnce(JobError.of('REJECTED'));
    await unsafeRequest(agent, 'post', '/api/v1/users/profile/email').send({ newEmail: 'third@example.test', currentPassword: password });
    await drainOutbox();
    const [second] = await OutboxEntry.find({ state: 'FAILED' });
    await unsafeRequest(agent, 'post', '/api/v1/users/profile/email').send({ newEmail: 'fourth@example.test', currentPassword: password });
    const blocked = await retry(second._id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('JOB_CANNOT_RETRY');
    expect((await OutboxEntry.findById(second._id)).state).toBe('FAILED');
  });

  it('sends a fresh link when retrying a link job that failed after sending', async () => {
    vi.spyOn(emailService, 'sendEmailChangeNotice').mockResolvedValue(undefined);
    const confirmation = vi.spyOn(emailService, 'sendEmailChangeConfirmation').mockResolvedValue(undefined);
    const { agent, password } = await createAuthenticatedAgent();
    await unsafeRequest(agent, 'post', '/api/v1/users/profile/email').send({ newEmail: 'late@example.test', currentPassword: password });
    await drainOutbox();
    // The link went out, then the job failed for good (its bookkeeping, say): the change failed and its link was removed.
    const link = await OutboxEntry.findOne({ type: 'email_change_link' });
    await OutboxEntry.updateOne({ _id: link._id }, { state: 'FAILED', lastErrorCode: 'INTERNAL', lastErrorAt: new Date() });
    await EmailChange.updateOne({}, { state: 'FAILED', failedCode: 'INTERNAL', endedAt: new Date(), $unset: { active: 1 } });
    const firstToken = confirmation.mock.calls.at(-1)[0].token;
    expect((await retry(link._id)).status).toBe(200);
    await drainOutbox();
    expect(confirmation).toHaveBeenCalledTimes(2);
    const freshToken = confirmation.mock.calls.at(-1)[0].token;
    expect(freshToken).not.toBe(firstToken);
    expect((await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/email/confirm').send({ token: freshToken })).status).toBe(200);
  });

  it('dismisses with a reason, and retries every failed job of a queue', async () => {
    const person = await createUserFixture();
    const first = await failedJob('password_changed', { userId: String(person._id) });
    await failedJob('password_changed', { userId: String(person._id) });
    await failedJob('password_reset_request', {});
    expect((await unsafeRequest(admin, 'post', `/api/v1/admin/jobs/${first._id}/dismiss`).send({ reason: 'x' })).status).toBe(400);
    const dismissed = await unsafeRequest(admin, 'post', `/api/v1/admin/jobs/${first._id}/dismiss`).send({ reason: 'Address no longer exists' });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.job).toMatchObject({ state: 'DISMISSED' });
    expect(await OutboxEntry.findById(first._id)).toMatchObject({ dismissReason: 'Address no longer exists', dismissedBy: adminUser._id });
    const all = await unsafeRequest(admin, 'post', '/api/v1/admin/jobs/retry-failed').send({ queue: 'email' });
    expect(all.status).toBe(200);
    expect(all.body).toEqual({ retried: 1, skipped: 1 });
  });
});
