const { createAuthenticatedAgent } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');

describe('AI filters on the report list', () => {
  it('lets staff list reports being classified, failed, or where AI disagrees', async () => {
    const pending = await createComplaintFixture({ ai: { status: 'PENDING', requestSeq: 1 } });
    const failed = await createComplaintFixture({ ai: { status: 'FAILED', requestSeq: 1, failureCode: 'TIMEOUT' } });
    const flagged = await createComplaintFixture({ categorySource: 'CITIZEN', ai: { status: 'DONE', requestSeq: 1, disagreement: { categoryId: failed.category, name: 'X', confidence: 0.9 } } });
    await createComplaintFixture({ ai: { status: 'DONE', requestSeq: 1 } });
    await createComplaintFixture({ categorySource: 'CITIZEN', ai: { status: 'DONE', requestSeq: 1, disagreement: { categoryId: null, name: 'X', confidence: 0.9 } } });
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const ids = async (query) => {
      const response = await agent.get(`/api/v1/complaints?${query}`);
      expect(response.status).toBe(200);
      return response.body.complaints.map((complaint) => complaint._id);
    };
    expect(await ids('aiStatus=PENDING')).toEqual([String(pending._id)]);
    expect(await ids('aiStatus=FAILED')).toEqual([String(failed._id)]);
    expect(await ids('disagreement=true')).toEqual([String(flagged._id)]);
    const { agent: agency } = await createAuthenticatedAgent({ role: 'agency' });
    const agencyResponse = await agency.get('/api/v1/complaints?aiStatus=FAILED');
    expect(agencyResponse.status).toBe(200);
    expect(agencyResponse.body.complaints.map((complaint) => complaint._id)).toEqual([String(failed._id)]);
  });

  it('refuses staff-only filters to citizens and invalid values to everyone', async () => {
    const { agent: citizen } = await createAuthenticatedAgent({ role: 'citizen' });
    expect((await citizen.get('/api/v1/complaints?aiStatus=FAILED')).status).toBe(403);
    expect((await citizen.get('/api/v1/complaints?disagreement=true')).status).toBe(403);
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    expect((await admin.get('/api/v1/complaints?aiStatus=DONE')).status).toBe(400);
    expect((await admin.get('/api/v1/complaints?disagreement=false')).status).toBe(400);
  });
});
