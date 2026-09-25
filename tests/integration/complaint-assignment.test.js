const mongoose = require('mongoose');
const { Complaint, User } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');
const { retireAccount } = require('../../services/accountRetirementService');

describe('PATCH /api/v1/complaints/:id/assign', () => {
  let adminAgent;
  let citizenAgent;
  let admin;
  let agency;
  let secondAgency;
  let complaint;

  beforeEach(async () => {
    ({ agent: adminAgent, user: admin } = await createAuthenticatedAgent({ role: 'admin' }));
    ({ agent: citizenAgent } = await createAuthenticatedAgent({ role: 'citizen' }));
    agency = await createUserFixture({ role: 'agency' });
    secondAgency = await createUserFixture({ role: 'agency' });
    complaint = await createComplaintFixture();
  });

  const assign = (agent, complaintId, body) => unsafeRequest(
    agent,
    'patch',
    `/api/v1/complaints/${complaintId}/assign`,
  )
    .send(body);

  it('assigns an active agency without changing complaint status', async () => {
    const response = await assign(adminAgent, complaint.id, { assignedTo: agency.id, reason: 'Routing' });

    expect(response.status).toBe(200);
    expect(response.body.complaint.status).toBe('PENDING');
    expect(response.body.complaint.assignee.userId).toBe(agency.id);
    expect(response.body.complaint.assignmentHistory).toHaveLength(1);
    expect(response.body.complaint.assignmentHistory[0]).toMatchObject({
      type: 'ASSIGNED',
      previous: null,
      next: { userId: agency.id, displayName: agency.name, role: 'agency' },
      changedBy: { userId: admin.id, displayName: admin.name, role: 'admin' },
      reason: 'Routing',
    });
    expect(JSON.stringify(response.body.complaint.assignmentHistory[0])).not.toMatch(/email|phone|avatar|password/i);
  });

  it('reassigns without changing complaint status', async () => {
    complaint.assignedTo = agency._id;
    await complaint.save();

    const response = await assign(adminAgent, complaint.id, { assignedTo: secondAgency.id, reason: 'Shift change' });

    expect(response.status).toBe(200);
    expect(response.body.complaint.status).toBe('PENDING');
    expect(response.body.complaint.assignmentHistory.at(-1)).toMatchObject({
      type: 'REASSIGNED',
      reason: 'Shift change',
      previous: { userId: agency.id },
      next: { userId: secondAgency.id },
    });
  });

  it('supports explicit null unassignment', async () => {
    complaint.assignedTo = agency._id;
    await complaint.save();

    const response = await assign(adminAgent, complaint.id, { assignedTo: null, reason: 'Queue reset' });

    expect(response.status).toBe(200);
    expect(response.body.complaint.assignee).toBeNull();
    expect(response.body.complaint.assignmentHistory.at(-1)).toMatchObject({
      type: 'UNASSIGNED',
      previous: { userId: agency.id },
      next: null,
    });
  });

  it.each([
    ['malformed complaint id', 'not-an-id', () => ({ assignedTo: agency.id })],
    ['malformed target id', () => complaint.id, () => ({ assignedTo: 'not-an-id' })],
    ['missing assignedTo', () => complaint.id, () => ({ reason: 'No target field' })],
    ['overlong reason', () => complaint.id, () => ({ assignedTo: agency.id, reason: 'x'.repeat(501) })],
  ])('returns 400 for %s', async (_label, complaintIdValue, bodyValue) => {
    const complaintId = typeof complaintIdValue === 'function' ? complaintIdValue() : complaintIdValue;
    const response = await assign(adminAgent, complaintId, bodyValue());

    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing complaint', async () => {
    const response = await assign(adminAgent, new mongoose.Types.ObjectId(), { assignedTo: agency.id });
    expect(response.status).toBe(404);
  });

  it('returns 404 for a missing assignment target', async () => {
    const response = await assign(adminAgent, complaint.id, { assignedTo: new mongoose.Types.ObjectId().toString() });
    expect(response.status).toBe(404);
  });

  it.each(['citizen', 'admin'])('rejects a %s target', async (role) => {
    const target = await createUserFixture({ role });
    const response = await assign(adminAgent, complaint.id, { assignedTo: target.id });
    expect(response.status).toBe(409);
  });

  it.each([
    ['inactive', { isActive: false }],
    ['retired', { retiredAt: new Date() }],
  ])('rejects an %s agency target', async (_label, overrides) => {
    const target = await createUserFixture({ role: 'agency', ...overrides });
    const response = await assign(adminAgent, complaint.id, { assignedTo: target.id });
    expect(response.status).toBe(409);
  });

  it('rejects a non-admin actor', async () => {
    const response = await assign(citizenAgent, complaint.id, { assignedTo: agency.id });
    expect(response.status).toBe(403);
  });

  it('rejects an inactive administrator even when the token says admin', async () => {
    await User.updateOne({ _id: admin._id }, { $set: { isActive: false } });
    const response = await assign(adminAgent, complaint.id, { assignedTo: agency.id });
    expect(response.status).toBe(401);
  });

  it('rejects a retired administrator even when the token says admin', async () => {
    await User.updateOne({ _id: admin._id }, { $set: { retiredAt: new Date() } });
    const response = await assign(adminAgent, complaint.id, { assignedTo: agency.id });
    expect(response.status).toBe(401);
  });

  it('rejects a downgraded administrator even when the token says admin', async () => {
    await User.updateOne({ _id: admin._id }, { $set: { role: 'citizen' } });
    const response = await assign(adminAgent, complaint.id, { assignedTo: agency.id });
    expect(response.status).toBe(403);
  });

  it('rejects the already-current assignee without appending history', async () => {
    complaint.assignedTo = agency._id;
    await complaint.save();

    const response = await assign(adminAgent, complaint.id, { assignedTo: agency.id });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignmentHistory).toHaveLength(0);
  });

  it('rejects unassigning an already-unassigned complaint', async () => {
    const response = await assign(adminAgent, complaint.id, { assignedTo: null });

    expect(response.status).toBe(409);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignmentHistory).toHaveLength(0);
  });

  it('preserves assignment snapshots after a user is renamed', async () => {
    const response = await assign(adminAgent, complaint.id, { assignedTo: agency.id });
    expect(response.status).toBe(200);

    await User.updateOne({ _id: agency._id }, { $set: { name: 'Renamed Agency' } });
    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignmentHistory[0].next.displayName).toBe(agency.name);
  });

  // Both carry the version they were made from, as the client sends it, so exactly one wins whether
  // the two overlap or (on a loaded machine) run one after the other; without it the second would
  // read the first one's result and reassign, which is itself allowed.
  it('allows only one winner for concurrent assignments from the same version', async () => {
    const expectedVersion = complaint.__v;
    const responses = await Promise.all([
      assign(adminAgent, complaint.id, { assignedTo: agency.id, reason: 'First contender', expectedVersion }),
      assign(adminAgent, complaint.id, { assignedTo: secondAgency.id, reason: 'Second contender', expectedVersion }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignmentHistory).toHaveLength(1);
    expect(stored.__v).toBe(1);
  });

  // The transaction re-reads the complaint and refuses if its version moved since the first read,
  // even when no expectedVersion was sent: the early check alone would miss a change that lands in
  // between. Forces that interleaving by serving the first read a copy taken before the change.
  it('refuses an assignment whose first read went stale before the transaction', async () => {
    const stale = await Complaint.findById(complaint.id).select('assignedTo status __v');
    await Complaint.updateOne({ _id: complaint.id }, { $inc: { __v: 1 } });
    const findById = vi.spyOn(Complaint, 'findById').mockImplementationOnce(() => ({ select: async () => stale }));
    const response = await assign(adminAgent, complaint.id, { assignedTo: agency.id });
    expect(findById).toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignedTo).toBeUndefined();
    expect(stored.assignmentHistory).toHaveLength(0);
    expect(stored.__v).toBe(stale.__v + 1);
  });

  it('cannot commit an assignment from a retirement transaction stale read', async () => {
    let markScanRead;
    let releaseScan;
    const scanRead = new Promise((resolve) => { markScanRead = resolve; });
    const scanRelease = new Promise((resolve) => { releaseScan = resolve; });
    const originalFind = Complaint.find.bind(Complaint);
    const find = vi.spyOn(Complaint, 'find').mockImplementation((...args) => {
      const query = originalFind(...args);
      if (args[0]?.$or?.some((clause) => Object.hasOwn(clause, 'assignedTo'))) {
        const originalExec = query.exec.bind(query);
        query.exec = async () => {
          const complaints = await originalExec();
          markScanRead();
          await scanRelease;
          return complaints;
        };
      }
      return query;
    });

    try {
      const retirement = retireAccount({
        targetUserId: agency.id,
        actorUserId: admin.id,
        reason: 'Concurrency regression',
      });
      await scanRead;
      const assignment = assign(adminAgent, complaint.id, { assignedTo: agency.id });
      setTimeout(releaseScan, 250);
      const [assignmentResponse] = await Promise.all([assignment, retirement]);

      const [storedComplaint, storedAgency] = await Promise.all([
        Complaint.findById(complaint.id),
        User.findById(agency.id),
      ]);
      expect(storedAgency.retiredAt).toBeInstanceOf(Date);
      expect(storedComplaint.assignedTo ?? null).toBeNull();
      expect(assignmentResponse.status).toBe(409);
    } finally {
      releaseScan();
      find.mockRestore();
    }
  });
});
