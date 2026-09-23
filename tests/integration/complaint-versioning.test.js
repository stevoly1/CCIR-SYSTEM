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

  it('reports a concurrent status change as STALE_COMPLAINT', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture();
    const [a, b] = await Promise.all([
      unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`).send({ status: 'IN_REVIEW' }),
      unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}/status`).send({ status: 'REJECTED', publicNote: 'Duplicate report' }),
    ]);
    const loser = [a, b].find((response) => response.status === 409);
    expect(loser.body.error.code).toBe('STALE_COMPLAINT');
  });
});
