const mongoose = require('mongoose');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { createComplaintFixture } = require('../fixtures/complaint');

const codes = (response) => response.body.complaints.map((complaint) => complaint.referenceCode);

describe('complaint list filters, search and single-complaint access', () => {
  let admin;
  let roads;
  let water;

  beforeEach(async () => {
    ({ agent: admin } = await createAuthenticatedAgent({ role: 'admin' }));
    roads = await createCategoryFixture({ name: 'Roads' });
    water = await createCategoryFixture({ name: 'Water' });
    await createComplaintFixture({ referenceCode: 'CCIR-LIST0001', category: roads._id, status: 'PENDING', priority: 'HIGH', description: 'Pothole near the market', location: { address: '1 Market Road' } });
    await createComplaintFixture({ referenceCode: 'CCIR-LIST0002', category: water._id, status: 'IN_REVIEW', priority: 'LOW', description: 'Burst pipe', location: { address: '9 Lake Street' } });
    await createComplaintFixture({ referenceCode: 'CCIR-LIST0003', category: roads._id, status: 'IN_REVIEW', priority: 'HIGH', description: 'Cracked kerb (a.b)', location: { address: '3 Hill View' } });
  });

  it.each([
    ['status', 'status=IN_REVIEW', ['CCIR-LIST0003', 'CCIR-LIST0002']],
    ['priority', 'priority=HIGH', ['CCIR-LIST0003', 'CCIR-LIST0001']],
    ['status and priority together', 'status=IN_REVIEW&priority=HIGH', ['CCIR-LIST0003']],
  ])('filters by %s', async (_label, query, expected) => {
    const response = await admin.get(`/api/v1/complaints?${query}`);
    expect(response.status).toBe(200);
    expect(codes(response)).toEqual(expected);
    expect(response.body.pagination.total).toBe(expected.length);
  });

  it('filters by category', async () => {
    const response = await admin.get(`/api/v1/complaints?category=${water.id}`);
    expect(codes(response)).toEqual(['CCIR-LIST0002']);
  });

  it.each([
    ['a reference code', 'list0002', ['CCIR-LIST0002']],
    ['description text', 'POTHOLE', ['CCIR-LIST0001']],
    ['an address', 'lake street', ['CCIR-LIST0002']],
    ['pattern characters, literally', '(a.b)', ['CCIR-LIST0003']],
    ['a pattern that would match everything', '.*', []],
  ])('searches %s', async (_label, search, expected) => {
    const response = await admin.get(`/api/v1/complaints?search=${encodeURIComponent(search)}`);
    expect(response.status).toBe(200);
    expect(codes(response)).toEqual(expected);
  });

  it('sorts oldest first on request', async () => {
    const response = await admin.get('/api/v1/complaints?sort=oldest');
    expect(codes(response)).toEqual(['CCIR-LIST0001', 'CCIR-LIST0002', 'CCIR-LIST0003']);
  });

  it('shows a citizen only their own reports, whatever the filters', async () => {
    const { agent: citizen, user } = await createAuthenticatedAgent({ role: 'citizen' });
    await createComplaintFixture({ referenceCode: 'CCIR-MINE0001', reporter: user._id, category: roads._id, status: 'IN_REVIEW' });
    const response = await citizen.get(`/api/v1/complaints?status=IN_REVIEW&category=${roads.id}`);
    expect(codes(response)).toEqual(['CCIR-MINE0001']);
  });

  it('answers 404 for an unknown complaint and 403 for someone else\'s', async () => {
    expect((await admin.get(`/api/v1/complaints/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    const { agent: citizen } = await createAuthenticatedAgent({ role: 'citizen' });
    const other = await createComplaintFixture({ referenceCode: 'CCIR-OTHER001' });
    const forbidden = await citizen.get(`/api/v1/complaints/${other.id}`);
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(forbidden.body)).not.toContain('CCIR-OTHER001');
  });

  it('answers 404 for a status update on an unknown complaint', async () => {
    const response = await unsafeRequest(admin, 'patch', `/api/v1/complaints/${new mongoose.Types.ObjectId()}/status`).send({ status: 'IN_REVIEW' });
    expect(response.status).toBe(404);
  });
});
