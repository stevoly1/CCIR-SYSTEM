const { Complaint } = require('../../models');
const { createAuthenticatedAgent } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');

describe('PATCH /api/v1/complaints/:id/status', () => {
  const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
  const allowed = new Set([
    'PENDING>IN_REVIEW',
    'PENDING>REJECTED',
    'IN_REVIEW>PENDING',
    'IN_REVIEW>IN_PROGRESS',
    'IN_REVIEW>REJECTED',
    'IN_PROGRESS>IN_REVIEW',
    'IN_PROGRESS>RESOLVED',
    'IN_PROGRESS>REJECTED',
    'RESOLVED>IN_PROGRESS',
    'REJECTED>PENDING',
  ]);

  const setup = async (status = 'PENDING') => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'agency' });
    const complaint = await createComplaintFixture({
      status,
      resolvedAt: status === 'RESOLVED' ? new Date('2026-09-19T00:00:00.000Z') : undefined,
      statusHistory: [{ status, note: 'Fixture starting state', changedBy: user._id }],
    });
    return { agent, user, complaint, path: `/api/v1/complaints/${complaint.id}/status` };
  };

  it.each(STATUSES.flatMap((from) => STATUSES.map((to) => [from, to])))('%s -> %s matches the route policy', async (from, to) => {
    const { agent, complaint, path } = await setup(from);
    const response = await agent.patch(path).send({ status: to, note: 'Correction required' });
    const permitted = allowed.has(`${from}>${to}`);

    expect(response.status).toBe(permitted ? 200 : 409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe(permitted ? to : from);
    expect(stored.statusHistory).toHaveLength(permitted ? 2 : 1);
  });

  it.each([
    ['IN_REVIEW', 'PENDING'],
    ['IN_PROGRESS', 'IN_REVIEW'],
    ['RESOLVED', 'IN_PROGRESS'],
    ['REJECTED', 'PENDING'],
  ])('requires a reason for %s -> %s without mutating', async (from, to) => {
    const { agent, complaint, path } = await setup(from);
    const originalVersion = complaint.__v;
    const response = await agent.patch(path).send({ status: to });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe(from);
    expect(stored.statusHistory).toHaveLength(1);
    expect(stored.__v).toBe(originalVersion);
  });

  it('rejects a whitespace-only required reason without mutating', async () => {
    const { agent, complaint, path } = await setup('RESOLVED');
    const response = await agent.patch(path).send({ status: 'IN_PROGRESS', note: '   ' });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe('RESOLVED');
    expect(stored.statusHistory).toHaveLength(1);
  });

  it('rejects an overlong reason before mutation', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await agent.patch(path).send({ status: 'IN_REVIEW', note: 'x'.repeat(501) });

    expect(response.status).toBe(400);
    expect((await Complaint.findById(complaint.id)).status).toBe('PENDING');
  });

  it('applies an optional valid priority only with a legal transition', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await agent.patch(path).send({ status: 'IN_REVIEW', priority: 'HIGH' });

    expect(response.status).toBe(200);
    expect(response.body.complaint).toMatchObject({ status: 'IN_REVIEW', priority: 'HIGH' });
    const stored = await Complaint.findById(complaint.id);
    expect(stored.statusHistory).toHaveLength(2);
  });

  it('rejects an invalid priority before mutation', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await agent.patch(path).send({ status: 'IN_REVIEW', priority: 'URGENT' });

    expect(response.status).toBe(400);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe('PENDING');
    expect(stored.statusHistory).toHaveLength(1);
  });

  it('rejects a priority-only duplicate without mutating priority or history', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const originalVersion = complaint.__v;
    const response = await agent.patch(path).send({ status: 'PENDING', priority: 'CRITICAL' });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.priority).toBe('MEDIUM');
    expect(stored.statusHistory).toHaveLength(1);
    expect(stored.__v).toBe(originalVersion);
  });

  it('sets resolvedAt when entering RESOLVED', async () => {
    const { agent, complaint, path } = await setup('IN_PROGRESS');
    const before = Date.now();
    const response = await agent.patch(path).send({ status: 'RESOLVED' });

    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.statusHistory.at(-1).status).toBe('RESOLVED');
    expect(stored.resolvedAt.getTime()).toBe(stored.statusHistory.at(-1).createdAt.getTime());
  });

  it('clears resolvedAt when reopening RESOLVED', async () => {
    const { agent, complaint, path } = await setup('RESOLVED');
    const response = await agent.patch(path).send({ status: 'IN_PROGRESS', note: 'Additional work found' });

    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.resolvedAt).toBeUndefined();
  });

  it('preserves resolvedAt absence on unrelated transitions', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await agent.patch(path).send({ status: 'IN_REVIEW' });

    expect(response.status).toBe(200);
    expect((await Complaint.findById(complaint.id)).resolvedAt).toBeUndefined();
  });

  it('accepts one of two concurrent transitions from the same version', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const [a, b] = await Promise.all([
      agent.patch(path).send({ status: 'IN_REVIEW' }),
      agent.patch(path).send({ status: 'REJECTED' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.statusHistory).toHaveLength(2);
    expect(stored.__v).toBe(1);
  });
});
