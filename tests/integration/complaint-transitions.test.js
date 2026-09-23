const mongoose = require('mongoose');
const { Complaint } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');

describe('PATCH /api/v1/complaints/:id/status', () => {
  const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'WITHDRAWN'];
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
      assignedTo: user._id,
      resolvedAt: status === 'RESOLVED' ? new Date('2026-09-19T00:00:00.000Z') : undefined,
      statusHistory: [{ status, publicNote: 'Fixture starting state', changedBy: user._id }],
    });
    return { agent, user, complaint, path: `/api/v1/complaints/${complaint.id}/status` };
  };

  it.each(STATUSES.flatMap((from) => STATUSES.map((to) => [from, to])))('%s -> %s matches the route policy', async (from, to) => {
    const { agent, complaint, path } = await setup(from);
    const response = await unsafeRequest(agent, 'patch', path).send({ status: to, publicNote: 'Correction required' });
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
    ['PENDING', 'REJECTED'],
    ['IN_REVIEW', 'REJECTED'],
    ['IN_PROGRESS', 'REJECTED'],
  ])('requires a reason for %s -> %s without mutating', async (from, to) => {
    const { agent, complaint, path } = await setup(from);
    const originalVersion = complaint.__v;
    const response = await unsafeRequest(agent, 'patch', path).send({ status: to });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe(from);
    expect(stored.statusHistory).toHaveLength(1);
    expect(stored.__v).toBe(originalVersion);
  });

  it('rejects a whitespace-only required reason without mutating', async () => {
    const { agent, complaint, path } = await setup('RESOLVED');
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'IN_PROGRESS', publicNote: '   ' });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe('RESOLVED');
    expect(stored.statusHistory).toHaveLength(1);
  });

  it('rejects an overlong reason before mutation', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'IN_REVIEW', publicNote: 'x'.repeat(501) });

    expect(response.status).toBe(400);
    expect((await Complaint.findById(complaint.id)).status).toBe('PENDING');
  });

  it('applies an optional valid priority only with a legal transition', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'IN_REVIEW', priority: 'HIGH' });

    expect(response.status).toBe(200);
    expect(response.body.complaint).toMatchObject({ status: 'IN_REVIEW', priority: 'HIGH' });
    const stored = await Complaint.findById(complaint.id);
    expect(stored.statusHistory).toHaveLength(2);
  });

  it('rejects an invalid priority before mutation', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'IN_REVIEW', priority: 'URGENT' });

    expect(response.status).toBe(400);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.status).toBe('PENDING');
    expect(stored.statusHistory).toHaveLength(1);
  });

  it('rejects a priority-only duplicate without mutating priority or history', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const originalVersion = complaint.__v;
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'PENDING', priority: 'CRITICAL' });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.priority).toBe('MEDIUM');
    expect(stored.statusHistory).toHaveLength(1);
    expect(stored.__v).toBe(originalVersion);
  });

  it('sets resolvedAt when entering RESOLVED', async () => {
    const { agent, complaint, path } = await setup('IN_PROGRESS');
    const before = Date.now();
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'RESOLVED' });

    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.statusHistory.at(-1).status).toBe('RESOLVED');
    expect(stored.resolvedAt.getTime()).toBe(stored.statusHistory.at(-1).createdAt.getTime());
  });

  it('clears resolvedAt when reopening RESOLVED', async () => {
    const { agent, complaint, path } = await setup('RESOLVED');
    await Complaint.updateOne({ _id: complaint._id }, { $set: { resolvedAtEstimated: true } });
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'IN_PROGRESS', publicNote: 'Additional work found' });

    expect(response.status).toBe(200);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.resolvedAt).toBeUndefined();
    expect(stored.resolvedAtEstimated).toBe(false);
  });

  it('clears the migrated estimate marker when resolving again', async () => {
    const { agent, complaint, path } = await setup('IN_PROGRESS');
    await Complaint.updateOne({ _id: complaint._id }, { $set: { resolvedAtEstimated: true } });

    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'RESOLVED' });

    expect(response.status).toBe(200);
    expect((await Complaint.findById(complaint.id)).resolvedAtEstimated).toBe(false);
  });

  it('returns the committed transition when the legacy reporter no longer exists', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const missingReporter = new mongoose.Types.ObjectId();
    await Complaint.updateOne({ _id: complaint._id }, {
      $set: {
        reporter: missingReporter,
        reporterSnapshot: { userId: missingReporter, displayName: 'Legacy Reporter', role: 'citizen' },
      },
    });

    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'IN_REVIEW' });

    expect(response.status).toBe(200);
    expect(response.body.complaint).toMatchObject({ status: 'IN_REVIEW' });
    expect(response.body.complaint.reporter).toMatchObject({
      userId: missingReporter.toString(),
      displayName: 'Unavailable account',
    });
  });

  it('preserves resolvedAt absence on unrelated transitions', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const response = await unsafeRequest(agent, 'patch', path).send({ status: 'IN_REVIEW' });

    expect(response.status).toBe(200);
    expect((await Complaint.findById(complaint.id)).resolvedAt).toBeUndefined();
  });

  it('accepts one of two concurrent transitions from the same version', async () => {
    const { agent, complaint, path } = await setup('PENDING');
    const [a, b] = await Promise.all([
      unsafeRequest(agent, 'patch', path).send({ status: 'IN_REVIEW' }),
      unsafeRequest(agent, 'patch', path).send({ status: 'REJECTED', publicNote: 'Duplicate report' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.statusHistory).toHaveLength(2);
    expect(stored.__v).toBe(1);
  });
});
