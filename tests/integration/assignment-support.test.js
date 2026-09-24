const { createAuthenticatedAgent } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');
const { createComplaintFixture } = require('../fixtures/complaint');

describe('assignment support', () => {
  it('lists only active, non-retired agency users without contact data', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    await createUserFixture({ role: 'agency', name: 'Zed Active' });
    await createUserFixture({ role: 'agency', name: 'Amy Active' });
    await createUserFixture({ role: 'agency', name: 'Inactive One', isActive: false });
    await createUserFixture({ role: 'agency', name: 'Retired One', retiredAt: new Date(), isActive: false });
    await createUserFixture({ role: 'citizen', name: 'Not Staff' });

    const response = await agent.get('/api/v1/users/assignable');
    expect(response.status).toBe(200);
    expect(response.body.users.map((u) => u.displayName)).toEqual(['Amy Active', 'Zed Active']);
    expect(Object.keys(response.body.users[0]).sort()).toEqual(['displayName', 'userId']);
    expect(JSON.stringify(response.body)).not.toMatch(/@example\.test|\+234/);
  });

  it('rejects unexpected query parameters', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    expect((await agent.get('/api/v1/users/assignable?role=admin')).status).toBe(400);
  });

  it.each(['agency', 'citizen'])('forbids %s', async (role) => {
    const { agent } = await createAuthenticatedAgent({ role });
    expect((await agent.get('/api/v1/users/assignable')).status).toBe(403);
  });

  it('forbids citizens from filtering by assignee', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    const response = await agent.get('/api/v1/complaints?assignedTo=0123456789abcdef01234567');
    expect(response.status).toBe(403);
  });

  it('lets staff filter by assignee', async () => {
    const { agent, user } = await createAuthenticatedAgent({ role: 'agency' });
    await createComplaintFixture({ assignedTo: user._id });
    await createComplaintFixture();
    const response = await agent.get(`/api/v1/complaints?assignedTo=${user.id}`);
    expect(response.status).toBe(200);
    expect(response.body.complaints).toHaveLength(1);
    expect(response.body.complaints[0].assignee.userId).toBe(user.id);
  });

  // Triage needs the reports nobody has taken yet.
  it('lets staff list unassigned reports with assignedTo=none', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const agency = await createUserFixture({ role: 'agency' });
    await createComplaintFixture({ assignedTo: agency._id });
    const open = await createComplaintFixture();
    const response = await agent.get('/api/v1/complaints?assignedTo=none');
    expect(response.status).toBe(200);
    expect(response.body.complaints.map((c) => c._id)).toEqual([open.id]);
    expect(response.body.complaints[0].assignee).toBeNull();
  });

  it('still forbids citizens from asking for unassigned reports', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'citizen' });
    expect((await agent.get('/api/v1/complaints?assignedTo=none')).status).toBe(403);
  });

  it('refuses any other word in place of an assignee', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    expect((await agent.get('/api/v1/complaints?assignedTo=nobody')).status).toBe(400);
  });
});
