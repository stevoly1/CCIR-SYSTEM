const { Complaint } = require('../../models');
const emailService = require('../../services/emailService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');

describe('POST /api/v1/complaints/:id/withdraw', () => {
  let agent;
  let user;

  beforeEach(async () => {
    ({ agent, user } = await createAuthenticatedAgent({ role: 'citizen' }));
  });

  const withdraw = (complaint, body = {}, as = agent) => unsafeRequest(as, 'post', `/api/v1/complaints/${complaint.id}/withdraw`).send(body);

  it('withdraws a pending complaint with the default public note and no email', async () => {
    const email = vi.spyOn(emailService, 'sendStatusUpdateEmail');
    const complaint = await createComplaintFixture({ reporter: user });
    const response = await withdraw(complaint);
    expect(response.status).toBe(200);
    expect(response.body.complaint).toMatchObject({ status: 'WITHDRAWN', canEdit: false, canWithdraw: false });
    const stored = await Complaint.findById(complaint.id);
    expect(stored.statusHistory.at(-1)).toMatchObject({ type: 'WITHDRAWN', status: 'WITHDRAWN', publicNote: 'Withdrawn by reporter' });
    expect(String(stored.statusHistory.at(-1).changedBy)).toBe(user.id);
    expect(stored.__v).toBe(complaint.__v + 1);
    expect(email).not.toHaveBeenCalled();
  });

  it('records the reason and unassigns any assignee', async () => {
    const agency = await createUserFixture({ role: 'agency', name: 'Assigned Agency' });
    const complaint = await createComplaintFixture({ reporter: user, assignedTo: agency._id });
    const response = await withdraw(complaint, { reason: '  Fixed by a neighbour  ' });
    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignedTo).toBeNull();
    expect(stored.statusHistory.at(-1).publicNote).toBe('Fixed by a neighbour');
    expect(stored.assignmentHistory.at(-1)).toMatchObject({ type: 'WITHDRAWAL_UNASSIGNMENT', next: null });
    expect(String(stored.assignmentHistory.at(-1).previous.userId)).toBe(agency.id);
    expect(String(stored.assignmentHistory.at(-1).changedBy.userId)).toBe(user.id);
  });

  it('treats a retry after success as success without a second entry', async () => {
    const complaint = await createComplaintFixture({ reporter: user });
    await withdraw(complaint);
    const retry = await withdraw(complaint);
    expect(retry.status).toBe(200);
    expect(retry.body.complaint.status).toBe('WITHDRAWN');
    expect((await Complaint.findById(complaint.id)).statusHistory.filter((e) => e.type === 'WITHDRAWN')).toHaveLength(1);
  });

  it('refuses a complaint already in review', async () => {
    const complaint = await createComplaintFixture({ reporter: user, status: 'IN_REVIEW' });
    const response = await withdraw(complaint);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COMPLAINT_NOT_EDITABLE');
    expect((await Complaint.findById(complaint.id)).status).toBe('IN_REVIEW');
  });

  it('rejects a stale expectedVersion', async () => {
    const complaint = await createComplaintFixture({ reporter: user });
    const response = await withdraw(complaint, { expectedVersion: complaint.__v + 1 });
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    expect((await Complaint.findById(complaint.id)).status).toBe('PENDING');
  });

  it('rejects an overlong reason and unknown fields', async () => {
    const complaint = await createComplaintFixture({ reporter: user });
    expect((await withdraw(complaint, { reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await withdraw(complaint, { note: 'old field' })).status).toBe(400);
  });

  it.each(['citizen', 'admin', 'agency'])('forbids a non-reporter %s', async (role) => {
    const complaint = await createComplaintFixture({ reporter: user });
    const { agent: other } = await createAuthenticatedAgent({ role });
    expect((await withdraw(complaint, {}, other)).status).toBe(403);
    expect((await Complaint.findById(complaint.id)).status).toBe('PENDING');
  });

  it('blocks staff transitions and assignment afterwards', async () => {
    const complaint = await createComplaintFixture({ reporter: user });
    await withdraw(complaint);
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const agency = await createUserFixture({ role: 'agency' });
    const transition = await unsafeRequest(admin, 'patch', `/api/v1/complaints/${complaint.id}/status`).send({ status: 'IN_REVIEW' });
    expect(transition.status).toBe(409);
    const assign = await unsafeRequest(admin, 'patch', `/api/v1/complaints/${complaint.id}/assign`).send({ assignedTo: agency.id });
    expect(assign.status).toBe(409);
    expect(assign.body.error.code).toBe('COMPLAINT_WITHDRAWN');
    const staffView = await admin.get(`/api/v1/complaints/${complaint.id}`);
    expect(staffView.body.complaint).toMatchObject({ allowedTransitions: [], canAssign: false, canChangePriority: false });
  });

  it('shows the withdrawal in the owner timeline', async () => {
    const complaint = await createComplaintFixture({ reporter: user });
    await withdraw(complaint, { reason: 'Already fixed' });
    const read = await agent.get(`/api/v1/complaints/${complaint.id}`);
    expect(read.body.complaint.timeline.at(-1)).toMatchObject({ type: 'WITHDRAWN', publicNote: 'Already fixed', actorLabel: 'You' });
  });
});
