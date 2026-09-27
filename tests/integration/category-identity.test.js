const { Category, Complaint, OutboxEntry } = require('../../models');
const complaintImageService = require('../../services/complaintImageService');
const { AiError } = require('../../services/ai/aiError');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { fakeClassification } = require('../helpers/ai');
const { drainOutbox } = require('../helpers/jobs');

describe('complaint category identity', () => {
  let agent;
  let other;
  let roads;

  beforeEach(async () => {
    ({ agent } = await createAuthenticatedAgent({ role: 'citizen' }));
    other = await createCategoryFixture({ name: 'Other', defaultPriority: 'LOW' });
    roads = await createCategoryFixture({ name: 'Roads', defaultPriority: 'HIGH' });
  });

  const file = (body = {}) => unsafeRequest(agent, 'post', '/api/v1/complaints')
    .send({ description: 'Pothole damaging tyres on the bypass', address: '1 Bypass Road', ...body });

  it('rejects an inactive hint before image preparation, AI, or persistence', async () => {
    const inactive = await createCategoryFixture({ name: 'Old Roads', isActive: false });
    const prepare = vi.spyOn(complaintImageService, 'prepareComplaintImages');
    const response = await file({ categoryId: inactive.id });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_INACTIVE');
    expect(await OutboxEntry.countDocuments({ type: 'classify_report' })).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    expect(await Complaint.countDocuments()).toBe(0);
  });

  it('rejects an unknown hint the same way', async () => {
    const response = await file({ categoryId: '0123456789abcdef01234567' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_INACTIVE');
    expect(await OutboxEntry.countDocuments({ type: 'classify_report' })).toBe(0);
  });

  it('keeps a valid citizen choice even when the AI names Other', async () => {
    fakeClassification({ category: 'Other' });
    await file({ categoryId: roads.id });
    await drainOutbox();
    const stored = await Complaint.findOne();
    expect(String(stored.category)).toBe(roads.id);
    expect(stored.categorySource).toBe('CITIZEN');
    expect(String(stored.citizenCategory.categoryId)).toBe(roads.id);
  });

  it('stores a snapshot and keeps the filed name after a rename', async () => {
    fakeClassification({ category: 'Roads' });
    const created = await file();
    expect(created.status).toBe(201);
    await drainOutbox();
    const stored = await Complaint.findOne();
    expect(stored.categorySnapshot.toObject()).toEqual({ categoryId: roads._id, name: 'Roads' });

    await Category.updateOne({ _id: roads._id }, { $set: { name: 'Road damage', nameKey: 'road damage' } });
    const read = await agent.get(`/api/v1/complaints/${stored.id}`);
    expect(read.body.complaint.category).toEqual({ _id: roads.id, name: 'Road damage', recordedName: 'Roads', isActive: true, deleted: false });
  });

  it('stays readable when the category document is gone', async () => {
    fakeClassification({ category: 'Roads' });
    await file();
    await drainOutbox();
    await Category.deleteOne({ _id: roads._id });
    const stored = await Complaint.findOne();
    const read = await agent.get(`/api/v1/complaints/${stored.id}`);
    expect(read.body.complaint.category).toMatchObject({ name: 'Roads', recordedName: 'Roads', deleted: true, isActive: false });
  });

  it("keeps the citizen's category and snapshot on AI failure", async () => {
    fakeClassification(AiError.of('TIMEOUT'));
    await file({ categoryId: roads.id });
    await drainOutbox();
    const stored = await Complaint.findOne();
    expect(stored.categorySnapshot.name).toBe('Roads');
    expect(String(stored.category)).toBe(roads.id);
    expect(stored).toMatchObject({ categorySource: 'CITIZEN', ai: { status: 'FAILED', failureCode: 'TIMEOUT' } });
  });

  it('normalises names and derives a unique key on save', async () => {
    const created = await Category.create({ name: '  Street   Lights ' });
    expect(created).toMatchObject({ name: 'Street Lights', nameKey: 'street lights', slug: 'street-lights' });
  });
});
