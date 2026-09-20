const mongoose = require('mongoose');
const { Complaint, User } = require('../../models');
const { createAuthenticatedAgent } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');
const { createCategoryFixture } = require('../fixtures/category');

describe('complaint historical identity reads', () => {
  let adminAgent;

  beforeEach(async () => {
    ({ agent: adminAgent } = await createAuthenticatedAgent({ role: 'admin' }));
  });

  const history = ({ userId, displayName, role }) => [{
    status: 'PENDING',
    note: 'Historical fixture',
    changedBy: userId,
    changedBySnapshot: { userId, displayName, role },
  }];

  it('returns a live reporter and status actor through contact-free identities', async () => {
    const reporter = await createUserFixture({ name: 'Live Reporter', email: 'live-reporter@example.test' });
    const complaint = await createComplaintFixture({
      reporter: reporter._id,
      reporterSnapshot: { userId: reporter._id, displayName: reporter.name },
      statusHistory: history({ userId: reporter._id, displayName: reporter.name, role: reporter.role }),
    });

    const response = await adminAgent.get(`/api/v1/complaints/${complaint.id}`);

    expect(response.status).toBe(200);
    expect(response.body.complaint.reporter).toMatchObject({
      userId: reporter.id,
      displayName: 'Live Reporter',
      role: 'citizen',
    });
    expect(response.body.complaint.statusHistory[0].changedBy).toMatchObject({
      userId: reporter.id,
      displayName: 'Live Reporter',
      role: 'citizen',
    });
    expect(JSON.stringify(response.body.complaint)).not.toMatch(/live-reporter@example\.test|phone|password|avatar/i);
  });

  it('does not mislabel a deactivated but non-retired identity', async () => {
    const reporter = await createUserFixture({ name: 'Inactive Reporter', isActive: false });
    const complaint = await createComplaintFixture({
      reporter: reporter._id,
      reporterSnapshot: { userId: reporter._id, displayName: reporter.name },
    });

    const response = await adminAgent.get(`/api/v1/complaints/${complaint.id}`);

    expect(response.status).toBe(200);
    expect(response.body.complaint.reporter.displayName).toBe('Inactive Reporter');
  });

  it('redacts a retired reporter and actor instead of exposing tombstones or snapshots', async () => {
    const reporter = await createUserFixture({ name: 'Sensitive Retired Name' });
    const tombstone = `retired+${reporter.id}@invalid.example`;
    await User.updateOne({ _id: reporter._id }, {
      $set: { email: tombstone, isActive: false, retiredAt: new Date() },
      $unset: { phone: 1, avatarUrl: 1 },
    });
    const complaint = await createComplaintFixture({
      reporter: reporter._id,
      reporterSnapshot: { userId: reporter._id, displayName: reporter.name },
      statusHistory: history({ userId: reporter._id, displayName: reporter.name, role: reporter.role }),
    });

    const response = await adminAgent.get(`/api/v1/complaints/${complaint.id}`);

    expect(response.status).toBe(200);
    expect(response.body.complaint.reporter).toMatchObject({ userId: reporter.id, displayName: 'Retired account' });
    expect(response.body.complaint.statusHistory[0].changedBy).toMatchObject({ userId: reporter.id, displayName: 'Retired account' });
    expect(JSON.stringify(response.body.complaint)).not.toContain(tombstone);
    expect(JSON.stringify(response.body.complaint)).not.toContain('Sensitive Retired Name');
  });

  it('returns unavailable identities for deliberately dangling legacy references', async () => {
    const missingId = new mongoose.Types.ObjectId();
    const complaint = await createComplaintFixture({
      reporter: missingId,
      reporterSnapshot: { userId: missingId, displayName: 'Sensitive Missing Reporter' },
      statusHistory: history({ userId: missingId, displayName: 'Sensitive Missing Actor', role: 'citizen' }),
    });

    const response = await adminAgent.get(`/api/v1/complaints/${complaint.id}`);

    expect(response.status).toBe(200);
    expect(response.body.complaint.reporter).toMatchObject({ userId: missingId.toString(), displayName: 'Unavailable account' });
    expect(response.body.complaint.statusHistory[0].changedBy).toMatchObject({
      userId: missingId.toString(),
      displayName: 'Unavailable account',
      role: 'citizen',
    });
    expect(JSON.stringify(response.body.complaint)).not.toMatch(/Sensitive Missing Reporter|Sensitive Missing Actor/);
  });

  it('redacts retired and dangling assignment-history snapshots without rewriting history', async () => {
    const reporter = await createUserFixture();
    const retiredAgency = await createUserFixture({ role: 'agency', name: 'Sensitive Retired Agency' });
    const retiredActor = await createUserFixture({ role: 'admin', name: 'Sensitive Retired Admin' });
    await User.updateMany(
      { _id: { $in: [retiredAgency._id, retiredActor._id] } },
      { $set: { isActive: false, retiredAt: new Date() } },
    );
    const missingAgency = new mongoose.Types.ObjectId();
    const complaint = await createComplaintFixture({
      reporter: reporter._id,
      reporterSnapshot: { userId: reporter._id, displayName: reporter.name },
      assignmentHistory: [{
        type: 'REASSIGNED',
        previous: { userId: retiredAgency._id, displayName: retiredAgency.name, role: 'agency' },
        next: { userId: missingAgency, displayName: 'Sensitive Missing Agency', role: 'agency' },
        changedBy: { userId: retiredActor._id, displayName: retiredActor.name, role: 'admin' },
        createdAt: new Date(),
      }],
    });

    const response = await adminAgent.get(`/api/v1/complaints/${complaint.id}`);

    expect(response.status).toBe(200);
    expect(response.body.complaint.assignmentHistory[0]).toMatchObject({
      previous: { userId: retiredAgency.id, displayName: 'Retired account', role: 'agency' },
      next: { userId: missingAgency.toString(), displayName: 'Unavailable account', role: 'agency' },
      changedBy: { userId: retiredActor.id, displayName: 'Retired account', role: 'admin' },
    });
    expect(JSON.stringify(response.body.complaint)).not.toMatch(/Sensitive Retired Agency|Sensitive Retired Admin|Sensitive Missing Agency/);

    const stored = await Complaint.findById(complaint.id);
    expect(stored.assignmentHistory[0].previous.displayName).toBe('Sensitive Retired Agency');
  });

  it('shapes live, retired, and dangling reporters safely in collection reads', async () => {
    const live = await createUserFixture({ name: 'Collection Live' });
    const retired = await createUserFixture({ name: 'Collection Retired' });
    await User.updateOne({ _id: retired._id }, { $set: { isActive: false, retiredAt: new Date() } });
    const dangling = new mongoose.Types.ObjectId();
    await Promise.all([
      createComplaintFixture({ reporter: live._id, reporterSnapshot: { userId: live._id, displayName: live.name } }),
      createComplaintFixture({ reporter: retired._id, reporterSnapshot: { userId: retired._id, displayName: retired.name } }),
      createComplaintFixture({ reporter: dangling, reporterSnapshot: { userId: dangling, displayName: 'Collection Missing' } }),
    ]);

    const response = await adminAgent.get('/api/v1/complaints');

    expect(response.status).toBe(200);
    expect(response.body.complaints.map((item) => item.reporter.displayName).sort()).toEqual([
      'Collection Live',
      'Retired account',
      'Unavailable account',
    ].sort());
    expect(JSON.stringify(response.body.complaints)).not.toMatch(/Collection Retired|Collection Missing/);
  });

  it('records reporter and actor snapshots at creation and transition boundaries', async () => {
    const { agent: citizenAgent, user: citizen } = await createAuthenticatedAgent({
      role: 'citizen',
      name: 'Snapshot Citizen',
    });
    await createCategoryFixture({ name: 'Other' });

    const created = await citizenAgent.post('/api/v1/complaints').send({
      description: 'A sufficiently detailed complaint for snapshot creation',
    });

    expect(created.status).toBe(201);
    expect(created.body.complaint.reporter).toMatchObject({
      userId: citizen.id,
      displayName: 'Snapshot Citizen',
      role: 'citizen',
    });
    expect(JSON.stringify(created.body.complaint)).not.toContain(citizen.email);

    const complaintId = created.body.complaint._id;
    const storedAfterCreate = await Complaint.findById(complaintId);
    expect(storedAfterCreate.reporterSnapshot).toMatchObject({
      userId: citizen._id,
      displayName: 'Snapshot Citizen',
      role: 'citizen',
    });
    expect(storedAfterCreate.statusHistory[0].changedBySnapshot).toMatchObject({
      userId: citizen._id,
      displayName: 'Snapshot Citizen',
      role: 'citizen',
    });

    const transitioned = await adminAgent
      .patch(`/api/v1/complaints/${complaintId}/status`)
      .send({ status: 'IN_REVIEW' });
    expect(transitioned.status).toBe(200);

    const storedAfterTransition = await Complaint.findById(complaintId);
    expect(storedAfterTransition.statusHistory.at(-1).changedBySnapshot).toMatchObject({
      displayName: expect.any(String),
      role: 'admin',
    });
  });
});
