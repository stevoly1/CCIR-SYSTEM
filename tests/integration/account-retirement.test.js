const { Complaint, RefreshToken, User } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');
const { retireAccount } = require('../../services/accountRetirementService');

describe('transactional account retirement', () => {
  it('soft-retires a citizen, removes credentials, and revokes sessions', async () => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'citizen', phone: '+234111111111' });
    const complaint = await createComplaintFixture({
      reporter: user._id,
      statusHistory: [{ status: 'PENDING', changedBy: user._id }],
    });

    const response = await unsafeRequest(agent, 'delete', '/api/v1/users/profile');

    expect(response.status).toBe(200);
    const retired = await User.findById(user.id).select('+password');
    expect(retired).toMatchObject({ name: 'Retired account', isActive: false });
    expect(retired.retiredAt).toBeInstanceOf(Date);
    expect(retired.retiredBy.toString()).toBe(user.id);
    expect(retired.email).toBe(`retired+${user.id}@invalid.local`);
    expect(retired.password).toBeUndefined();
    expect(retired.phone).toBeUndefined();
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(0);
    const preserved = await Complaint.findById(complaint.id);
    expect(preserved.reporterSnapshot).toMatchObject({ userId: user._id, displayName: user.name, role: 'citizen' });
    expect(preserved.statusHistory[0].changedBySnapshot).toMatchObject({
      userId: user._id,
      displayName: user.name,
      role: 'citizen',
    });
  });

  it('retires an agency, preserves snapshots, and unassigns only nonterminal complaints', async () => {
    const { agent, user: agency } = await createAuthenticatedAgent({ role: 'agency', name: 'Agency To Retire' });
    const reporter = await createUserFixture();
    const open = await createComplaintFixture({ reporter, assignedTo: agency._id, status: 'IN_PROGRESS' });
    const resolved = await createComplaintFixture({ reporter, assignedTo: agency._id, status: 'RESOLVED', resolvedAt: new Date() });

    const response = await unsafeRequest(agent, 'delete', '/api/v1/users/profile');

    expect(response.status).toBe(200);
    const storedOpen = await Complaint.findById(open.id);
    expect(storedOpen.assignedTo).toBeNull();
    expect(storedOpen.assignmentHistory.at(-1)).toMatchObject({
      type: 'RETIREMENT_UNASSIGNMENT',
      previous: { userId: agency._id, displayName: 'Agency To Retire', role: 'agency' },
      next: null,
    });
    const storedResolved = await Complaint.findById(resolved.id);
    expect(storedResolved.assignedTo.toString()).toBe(agency.id);
  });

  it('rejects administrator self-retirement', async () => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'admin' });

    const response = await unsafeRequest(agent, 'delete', '/api/v1/users/profile');

    expect(response.status).toBe(409);
    expect(await User.findById(user.id)).toMatchObject({ role: 'admin', isActive: true });
  });

  it('allows an administrator to retire another account', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture({ role: 'citizen' });

    const response = await unsafeRequest(agent, 'delete', `/api/v1/users/${target.id}`);

    expect(response.status).toBe(200);
    expect(await User.findById(target.id)).toMatchObject({ isActive: false });
  });

  it('rejects a repeated retirement without mutating the tombstone', async () => {
    const { user: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture({ role: 'citizen' });
    await retireAccount({ targetUserId: target.id, actorUserId: admin.id, reason: 'Requested' });
    const once = await User.findById(target.id);

    await expect(retireAccount({
      targetUserId: target.id,
      actorUserId: admin.id,
      reason: 'Requested again',
    })).rejects.toMatchObject({ statusCode: 409 });
    const twice = await User.findById(target.id);
    expect(twice.email).toBe(once.email);
    expect(twice.retiredAt).toEqual(once.retiredAt);
  });

  it('rejects an overlong retirement reason before mutation', async () => {
    const { user: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const target = await createUserFixture({ role: 'citizen' });

    await expect(retireAccount({
      targetUserId: target.id,
      actorUserId: admin.id,
      reason: 'x'.repeat(501),
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(await User.findById(target.id)).toMatchObject({ isActive: true });
  });

  it('rolls back complaint and user changes when token revocation fails', async () => {
    const { agent, user: agency } = await createAuthenticatedAgent({ role: 'agency' });
    const complaint = await createComplaintFixture({ assignedTo: agency._id, status: 'IN_PROGRESS' });
    const deleteTokens = vi.spyOn(RefreshToken, 'deleteMany').mockRejectedValueOnce(new Error('injected token failure'));

    const response = await unsafeRequest(agent, 'delete', '/api/v1/users/profile');

    expect(response.status).toBe(500);
    expect(await User.findById(agency.id)).toMatchObject({ isActive: true });
    expect((await Complaint.findById(complaint.id)).assignedTo.toString()).toBe(agency.id);
    deleteTokens.mockRestore();
  });

  it('requires open complaints to be unassigned before an agency is deactivated', async () => {
    const { agent: adminAgent } = await createAuthenticatedAgent({ role: 'admin' });
    const agency = await createUserFixture({ role: 'agency' });
    const complaint = await createComplaintFixture({ assignedTo: agency._id, status: 'IN_PROGRESS' });

    const response = await unsafeRequest(adminAgent, 'patch', `/api/v1/users/${agency.id}`)
      .send({ isActive: false, reason: 'Contract ended' });

    expect(response.status).toBe(409);
    expect(await User.findById(agency.id)).toMatchObject({ isActive: true, role: 'agency' });
    expect((await Complaint.findById(complaint.id)).assignedTo.toString()).toBe(agency.id);
  });

  it('allows only assignment or agency deactivation to win concurrently', async () => {
    const { agent: adminAgent } = await createAuthenticatedAgent({ role: 'admin' });
    const agency = await createUserFixture({ role: 'agency' });
    const complaint = await createComplaintFixture({ status: 'IN_PROGRESS' });

    const [assignment, deactivation] = await Promise.all([
      unsafeRequest(adminAgent, 'patch', `/api/v1/complaints/${complaint.id}/assign`)
        .send({ assignedTo: agency.id }),
      unsafeRequest(adminAgent, 'patch', `/api/v1/users/${agency.id}`)
        .send({ isActive: false, reason: 'Contract ended' }),
    ]);

    expect([assignment.status, deactivation.status].sort()).toEqual([200, 409]);
    const [storedComplaint, storedAgency] = await Promise.all([
      Complaint.findById(complaint.id),
      User.findById(agency.id),
    ]);
    expect(storedAgency.isActive === false && Boolean(storedComplaint.assignedTo)).toBe(false);
  });

  it('serializes two administrators concurrently demoting each other', async () => {
    const { agent: firstAgent, user: first } = await createAuthenticatedAgent({ role: 'admin' });
    const { agent: secondAgent, user: second } = await createAuthenticatedAgent({ role: 'admin' });

    const results = await Promise.all([
      unsafeRequest(firstAgent, 'patch', `/api/v1/users/${second.id}`).send({ role: 'citizen' }),
      unsafeRequest(secondAgent, 'patch', `/api/v1/users/${first.id}`).send({ role: 'citizen' }),
    ]);

    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409 || result.status === 403)).toHaveLength(1);
    expect(await User.countDocuments({ role: 'admin', isActive: true })).toBeGreaterThanOrEqual(1);
  });
});
