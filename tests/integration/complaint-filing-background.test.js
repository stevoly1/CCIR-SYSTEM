const { Category, Complaint, OutboxEntry } = require('../../models');
const ai = require('../../services/ai');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { drainOutbox } = require('../helpers/jobs');
const { fakeClassification } = require('../helpers/ai');

const file = (agent, fields) => {
  const request = unsafeRequest(agent, 'post', '/api/v1/complaints')
    .field('description', 'A deep pothole on Market Road near the school')
    .field('address', '12 Market Road');
  for (const [name, value] of Object.entries(fields ?? {})) request.field(name, value);
  return request;
};

describe('filing a report for background classification', () => {
  let other;
  let roads;
  beforeEach(async () => {
    other = await Category.findOne({ name: 'Other' }) ?? await createCategoryFixture({ name: 'Other', defaultPriority: 'LOW' });
    roads = await createCategoryFixture({ name: 'Roads', defaultPriority: 'HIGH' });
  });

  it('answers without asking the AI, as Other pending classification', async () => {
    const classify = vi.spyOn(ai, 'classifyReport');
    const { agent } = await createAuthenticatedAgent();
    const response = await file(agent);
    expect(response.status).toBe(201);
    expect(classify).not.toHaveBeenCalled();
    const saved = await Complaint.findById(response.body.complaint._id).lean();
    expect(saved).toMatchObject({ category: other._id, categorySource: 'PENDING', priority: 'LOW', prioritySource: 'CATEGORY_DEFAULT', ai: { status: 'PENDING', requestSeq: 1, analysisCount: 1 } });
    const entries = await OutboxEntry.find({ 'refs.complaintId': String(saved._id) }).lean();
    expect(entries.map((entry) => [entry.queue, entry.type, entry.refs.requestSeq])).toEqual(expect.arrayContaining([['ai', 'classify_report', 1], ['email', 'report_filed', undefined]]));
  });

  it("keeps the citizen's category, with its default priority", async () => {
    const { agent } = await createAuthenticatedAgent();
    const response = await file(agent, { categoryId: String(roads._id) });
    expect(response.status).toBe(201);
    expect(await Complaint.findById(response.body.complaint._id).lean()).toMatchObject({
      category: roads._id, categorySource: 'CITIZEN', citizenCategory: { categoryId: roads._id, name: 'Roads' }, priority: 'HIGH', prioritySource: 'CATEGORY_DEFAULT',
    });
  });

  it("then takes the AI's answer from the job", async () => {
    fakeClassification({ category: 'Roads', priority: 'CRITICAL' });
    const { agent } = await createAuthenticatedAgent();
    const response = await file(agent);
    await drainOutbox();
    expect(await Complaint.findById(response.body.complaint._id).lean()).toMatchObject({ category: roads._id, categorySource: 'AI', priority: 'CRITICAL', ai: { status: 'DONE' } });
  });

  it('saves nothing when the classification job cannot be written', async () => {
    const { agent } = await createAuthenticatedAgent();
    const create = OutboxEntry.create.bind(OutboxEntry);
    vi.spyOn(OutboxEntry, 'create').mockImplementation((docs, options) => (docs[0].type === 'classify_report' ? Promise.reject(new Error('outbox down')) : create(docs, options)));
    expect((await file(agent)).status).toBe(500);
    expect(await Complaint.countDocuments()).toBe(0);
    expect(await OutboxEntry.countDocuments()).toBe(0);
  });

  it('fails before filing when the required active Other category is absent', async () => {
    await Category.updateOne({ _id: other._id }, { $set: { isActive: false } });
    const { agent } = await createAuthenticatedAgent();
    expect((await file(agent, { categoryId: String(roads._id) })).status).toBe(500);
    expect(await Complaint.countDocuments()).toBe(0);
    expect(await OutboxEntry.countDocuments({ type: 'classify_report' })).toBe(0);
  });
});
