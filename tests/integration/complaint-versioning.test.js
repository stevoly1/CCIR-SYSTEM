const { Complaint } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');

describe('expectedVersion', () => {
  it('rejects a stale status update without writing', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`)
      .send({ status: 'IN_REVIEW', expectedVersion: complaint.__v + 1 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe('PENDING');
    expect(stored.__v).toBe(complaint.__v);
  });

  it('rejects a stale assignment without writing', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const agency = await createUserFixture({ role: 'agency' });
    const complaint = await createComplaintFixture();
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/assign`)
      .send({ assignedTo: agency.id, expectedVersion: complaint.__v + 1 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignedTo).toBeUndefined();
    expect(stored.assignmentHistory).toHaveLength(0);
  });

  it('accepts the matching version and returns the next one', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`)
      .send({ status: 'IN_REVIEW', expectedVersion: complaint.__v });
    expect(response.status).toBe(200);
    expect(response.body.complaint.version).toBe(complaint.__v + 1);
  });

  it('accepts a matching assignment version', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const agency = await createUserFixture({ role: 'agency' });
    const complaint = await createComplaintFixture();
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/assign`)
      .send({ assignedTo: agency.id, expectedVersion: complaint.__v });
    expect(response.status).toBe(200);
    expect(response.body.complaint.assignee.userId).toBe(agency.id);
  });

  it.each([-1, 1.5, '2', null])('rejects malformed expectedVersion %s', async (value) => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`)
      .send({ status: 'IN_REVIEW', expectedVersion: value });
    expect(response.status).toBe(400);
    const detail = response.body.error.details.find((item) => item.path === 'body.expectedVersion');
    expect(detail).toBeDefined();
    expect(detail.code).not.toBe('UNKNOWN_FIELD');
  });

  // The write itself is pinned to the version the request read, so a change that lands between the
  // read and the write is refused even when no expectedVersion was sent: the early check alone would
  // miss it. Forces that interleaving by serving the request a copy read before the other change.
  it('refuses a status change whose read went stale before the write', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const stale = await Complaint.findById(complaint.id);
    await Complaint.updateOne({ _id: complaint.id }, { $inc: { __v: 1 } });
    const findById = vi.spyOn(Complaint, 'findById').mockImplementationOnce(async () => stale);
    const response = await unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`).send({ status: 'IN_REVIEW' });
    expect(findById).toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe('PENDING');
    expect(stored.statusHistory).toHaveLength(stale.statusHistory.length);
    expect(stored.__v).toBe(stale.__v + 1);
  });

  // Both requests carry the version they were made from, as the client sends it, so exactly one wins
  // whether the two overlap or (on a loaded machine) run one after the other. Without it the second
  // request would read the first one's result, and IN_REVIEW -> REJECTED is itself a valid change.
  it('reports a concurrent status change as STALE_COMPLAINT', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const expectedVersion = complaint.__v;
    const [a, b] = await Promise.all([
      unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`).send({ status: 'IN_REVIEW', expectedVersion }),
      unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`).send({ status: 'REJECTED', publicNote: 'Duplicate report', expectedVersion }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [winner, loser] = a.status === 200 ? [a, b] : [b, a];
    expect(loser.body.error.code).toBe('STALE_COMPLAINT');
    expect((await Complaint.findById(complaint.id)).status).toBe(winner.body.complaint.status);
  });
});
