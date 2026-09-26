const { Complaint, OutboxEntry } = require('../../models');
const emailService = require('../../services/emailService');
const { drainOutbox } = require('../helpers/jobs');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');
const { captureLogs } = require('../helpers/captureLogs');

const status = (agent, complaint, body) => unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`).send(body);

describe('status authority', () => {
  it('lets the assigned agency user transition and refuses other agency users', async () => {
    const { agent: assigned, user: agencyA } = await createAuthenticatedAgent({ role: 'agency' });
    const { agent: other } = await createAuthenticatedAgent({ role: 'agency' });
    const complaint = await createComplaintFixture({ assignedTo: agencyA._id });

    const refused = await status(other, complaint, { status: 'IN_REVIEW' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('NOT_ASSIGNED_TO_YOU');
    expect((await Complaint.findById(complaint.id)).status).toBe('PENDING');

    expect((await status(assigned, complaint, { status: 'IN_REVIEW' })).status).toBe(200);
  });

  it('refuses an agency user on an unassigned complaint', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'agency' });
    const complaint = await createComplaintFixture();
    const response = await status(agent, complaint, { priority: 'HIGH' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_ASSIGNED_TO_YOU');
  });

  it('lets an administrator act on an unassigned complaint', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    expect((await status(agent, complaint, { status: 'IN_REVIEW' })).status).toBe(200);
  });

  it('loses safely when the complaint is reassigned mid-request', async () => {
    const { agent, user: agencyA } = await createAuthenticatedAgent({ role: 'agency' });
    const agencyB = await createUserFixture({ role: 'agency' });
    const complaint = await createComplaintFixture({ assignedTo: agencyA._id });
    const stale = await Complaint.findById(complaint.id);
    await Complaint.updateOne({ _id: complaint._id }, { $set: { assignedTo: agencyB._id }, $inc: { __v: 1 } });
    vi.spyOn(Complaint, 'findById').mockResolvedValueOnce(stale);

    const response = await status(agent, complaint, { status: 'IN_REVIEW' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_ASSIGNED_TO_YOU');
    expect((await Complaint.findById(complaint.id)).status).toBe('PENDING');
  });

  it('records a priority-only change as staff priority without emailing', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const email = vi.spyOn(emailService, 'sendStatusUpdateEmail');
    const complaint = await createComplaintFixture({ status: 'IN_REVIEW', priority: 'LOW', prioritySource: 'AI' });
    const response = await status(agent, complaint, { priority: 'CRITICAL', internalNote: 'Near a school' });
    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored).toMatchObject({ status: 'IN_REVIEW', priority: 'CRITICAL', prioritySource: 'STAFF' });
    expect(stored.statusHistory.at(-1)).toMatchObject({ type: 'PRIORITY_CHANGED', status: 'IN_REVIEW', internalNote: 'Near a school' });
    expect(stored.statusHistory.at(-1).priorityChange).toMatchObject({ from: 'LOW', to: 'CRITICAL' });
    await drainOutbox();
    expect(email).not.toHaveBeenCalled();
  });

  it('marks priority as staff-set when a transition also changes it', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture({ priority: 'LOW', prioritySource: 'AI' });
    await status(agent, complaint, { status: 'IN_REVIEW', priority: 'HIGH' });
    expect(await Complaint.findById(complaint.id)).toMatchObject({ priority: 'HIGH', prioritySource: 'STAFF' });
  });

  it('keeps the priority source when a transition repeats the current priority', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture({ priority: 'LOW', prioritySource: 'AI' });
    await status(agent, complaint, { status: 'IN_REVIEW', priority: 'LOW' });
    expect(await Complaint.findById(complaint.id)).toMatchObject({ priority: 'LOW', prioritySource: 'AI' });
  });

  it('refuses a no-op and an empty update', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture({ priority: 'LOW' });
    const noop = await status(agent, complaint, { priority: 'LOW' });
    expect(noop.status).toBe(409);
    expect(noop.body.error.code).toBe('NO_CHANGE');
    expect((await status(agent, complaint, {})).status).toBe(400);
    expect((await status(agent, complaint, { publicNote: 'only a note' })).status).toBe(400);
  });

  it('requires a public note to reject', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    expect((await status(agent, complaint, { status: 'REJECTED', internalNote: 'duplicate' })).status).toBe(409);
    expect((await status(agent, complaint, { status: 'REJECTED', publicNote: 'Duplicate of an earlier report' })).status).toBe(200);
  });

  it('shows an unassigned agency user no status actions and the assignee full actions', async () => {
    const { agent: unassigned } = await createAuthenticatedAgent({ role: 'agency' });
    const { agent: assigned, user } = await createAuthenticatedAgent({ role: 'agency' });
    const complaint = await createComplaintFixture({ assignedTo: user._id });
    const other = await unassigned.get(`/api/v1/complaints/${complaint.id}`);
    expect(other.body.complaint).toMatchObject({ allowedTransitions: [], canChangePriority: false, canAssign: false });
    const mine = await assigned.get(`/api/v1/complaints/${complaint.id}`);
    expect(mine.body.complaint).toMatchObject({ allowedTransitions: ['IN_REVIEW', 'REJECTED'], canChangePriority: true, canAssign: false });
  });

  it('still records the status change when the email provider fails, and the job records the failure without the recipient', async () => {
    // A fresh copy of the real email service with a provider key, so the Resend SDK itself runs.
    const servicePath = require.resolve('../../services/emailService');
    const cached = require.cache[servicePath];
    vi.stubEnv('RESEND_API_KEY', 're_integration_fake');
    delete require.cache[servicePath];
    const realService = require('../../services/emailService');
    require.cache[servicePath] = cached;
    vi.spyOn(emailService, 'sendStatusUpdateEmail').mockImplementation(realService.sendStatusUpdateEmail);
    const providerCall = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ name: 'application_error', message: 'provider down', statusCode: 500 }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the SDK's own non-production message
    const reporter = await createUserFixture({ email: 'status.reporter@example.test' });
    const complaint = await createComplaintFixture({ reporter: reporter._id });
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const logs = captureLogs();
    try {
      const response = await status(agent, complaint, { status: 'IN_REVIEW' });

      expect(response.status).toBe(200);
      expect((await Complaint.findById(complaint.id)).status).toBe('IN_REVIEW');
      expect(providerCall).not.toHaveBeenCalled();
      await drainOutbox();
      expect(providerCall).toHaveBeenCalledTimes(1);
      expect(await OutboxEntry.findOne({ type: 'status_update' })).toMatchObject({ state: 'FAILED', lastErrorCode: 'PROVIDER_DOWN' });
      expect(logs.lines.find((line) => line.event === 'job')).toMatchObject({ type: 'status_update', outcome: 'failed', failureCode: 'PROVIDER_DOWN' });
      expect(logs.text()).not.toContain('status.reporter@example.test');
    } finally {
      logs.restore();
    }
  });
});
