const { Complaint, OutboxEntry } = require('../../models');
const { inTransaction } = require('../../utils/transaction');
const { enqueueClassification } = require('../../services/classificationRequests');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { createComplaintFixture } = require('../fixtures/complaint');
const { fakeClassification } = require('../helpers/ai');
const { drainOutbox } = require('../helpers/jobs');

describe('PATCH /api/v1/complaints/:id (pending edit)', () => {
  let agent;
  let user;
  let other;
  let roads;
  let drainage;

  beforeEach(async () => {
    ({ agent, user } = await createAuthenticatedAgent({ role: 'citizen' }));
    other = await createCategoryFixture({ name: 'Other', defaultPriority: 'LOW' });
    roads = await createCategoryFixture({ name: 'Roads', defaultPriority: 'HIGH' });
    drainage = await createCategoryFixture({ name: 'Drainage', defaultPriority: 'MEDIUM' });
  });

  const pending = (overrides = {}) => createComplaintFixture({
    reporter: user,
    description: 'Large pothole near the bus stop',
    category: roads,
    categorySnapshot: { categoryId: roads._id, name: 'Roads' },
    categorySource: 'AI',
    priority: 'HIGH',
    prioritySource: 'AI',
    ai: { status: 'DONE', requestSeq: 1, suggestedCategory: 'Roads', confidence: 0.9, summary: 'old summary', tags: ['road'], classifiedAt: new Date('2026-09-01'), inputMode: 'TEXT_AND_IMAGE', analysisCount: 1 },
    location: { address: 'Bus stop, Ikeja' },
    ...overrides,
  });
  const edit = (complaint, body) => unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}`).send(body);
  const jobs = (seq) => OutboxEntry.countDocuments({ type: 'classify_report', ...(seq ? { 'refs.requestSeq': seq } : {}) });

  it('asks for a new classification on a material edit, leaving the category until the AI answers', async () => {
    const complaint = await pending();
    const classify = fakeClassification({ category: 'Drainage', priority: 'MEDIUM' });
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(200);
    expect(response.body.reanalysed).toBe(true);
    const stored = await Complaint.findById(complaint.id).lean();
    expect(stored).toMatchObject({ category: roads._id, priority: 'HIGH', ai: { status: 'PENDING', requestSeq: 2, analysisCount: 2 } });
    for (const field of ['suggestedCategory', 'confidence', 'summary', 'tags', 'classifiedAt', 'inputMode']) {
      expect(stored.ai[field], field).toBeUndefined();
    }
    expect(stored.editHistory[0]).toMatchObject({ fields: ['description'], reanalysed: true });
    expect(stored.__v).toBe(complaint.__v + 1);
    expect(await jobs(2)).toBe(1);
    expect(classify).not.toHaveBeenCalled();
    await drainOutbox();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(await Complaint.findById(complaint.id).lean()).toMatchObject({
      category: drainage._id, categorySnapshot: { name: 'Drainage' }, categorySource: 'AI', priority: 'MEDIUM', prioritySource: 'AI',
      ai: { status: 'DONE', requestSeq: 2, suggestedCategory: 'Drainage' },
    });
  });

  it("drops the earlier request's answer when an edit asked again before it ran", async () => {
    const complaint = await pending({ ai: { status: 'PENDING', requestSeq: 1, analysisCount: 1 }, categorySource: 'PENDING', category: other, categorySnapshot: { categoryId: other._id, name: 'Other' } });
    await inTransaction((session) => enqueueClassification(session, complaint));
    const classify = fakeClassification(({ description }) => (/drain/i.test(description) ? { category: 'Drainage' } : { category: 'Roads' }));
    expect((await edit(complaint, { description: 'Blocked drain flooding the bus stop' })).status).toBe(200);
    await drainOutbox();
    expect(await Complaint.findById(complaint.id).lean()).toMatchObject({ category: drainage._id, ai: { requestSeq: 2, status: 'DONE' } });
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("keeps a citizen's category and a staff priority through re-classification, and flags disagreement", async () => {
    const complaint = await pending({ categorySource: 'CITIZEN', prioritySource: 'STAFF', priority: 'CRITICAL' });
    fakeClassification({ category: 'Drainage', priority: 'LOW', confidence: 0.95 });
    await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    await drainOutbox();
    expect(await Complaint.findById(complaint.id).lean()).toMatchObject({
      category: roads._id, categorySource: 'CITIZEN', priority: 'CRITICAL', prioritySource: 'STAFF', ai: { disagreement: { name: 'Drainage', confidence: 0.95 } },
    });
  });

  it('saves nothing when the classification job cannot be written', async () => {
    const complaint = await pending();
    const create = OutboxEntry.create.bind(OutboxEntry);
    vi.spyOn(OutboxEntry, 'create').mockImplementation((docs, options) => (docs[0].type === 'classify_report' ? Promise.reject(new Error('outbox down')) : create(docs, options)));
    expect((await edit(complaint, { description: 'Blocked drain flooding the bus stop' })).status).toBe(500);
    expect(await Complaint.findById(complaint.id).lean()).toMatchObject({ description: 'Large pothole near the bus stop', ai: { requestSeq: 1, status: 'DONE' } });
    expect(await jobs()).toBe(0);
  });

  it('clears an earlier classification failure when a material edit requests a new answer', async () => {
    const complaint = await pending({ ai: {
      status: 'FAILED', requestSeq: 1, analysisCount: 1,
      failureCode: 'TIMEOUT', failedAt: new Date('2026-09-01'),
    } });
    expect((await edit(complaint, { description: 'Blocked drain flooding the bus stop' })).status).toBe(200);
    const stored = await Complaint.findById(complaint.id).lean();
    expect(stored.ai).toMatchObject({ status: 'PENDING', requestSeq: 2, analysisCount: 2 });
    expect(stored.ai.failureCode).toBeUndefined();
    expect(stored.ai.failedAt).toBeUndefined();
    expect(await jobs(2)).toBe(1);
  });

  it.each([
    ['whitespace-only description', { description: '  Large   pothole near the bus stop ' }, ['description']],
    ['location-only', { location: { address: 'Opposite the bus stop, Ikeja' } }, ['location']],
  ])('does not re-analyse a %s edit', async (_label, body, fields) => {
    const complaint = await pending();
    const response = await edit(complaint, body);
    expect(response.status).toBe(200);
    expect(response.body.reanalysed).toBe(false);
    expect(await jobs()).toBe(0);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.ai.summary).toBe('old summary');
    expect(stored.ai.analysisCount).toBe(1);
    expect(stored.editHistory[0]).toMatchObject({ fields, reanalysed: false });
  });

  it('treats an identical description as a no-op without a history entry', async () => {
    const complaint = await pending();
    const response = await edit(complaint, { description: 'Large pothole near the bus stop' });
    expect(response.status).toBe(200);
    expect(response.body.reanalysed).toBe(false);
    const stored = await Complaint.findById(complaint.id);
    expect(stored.editHistory).toHaveLength(0);
    expect(stored.__v).toBe(complaint.__v);
    expect(await jobs()).toBe(0);
  });

  it('refuses non-pending complaints without writing a job', async () => {
    const complaint = await pending({ status: 'IN_REVIEW' });
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COMPLAINT_NOT_EDITABLE');
    expect(await jobs()).toBe(0);
  });

  it('writes nothing when staff move the complaint during re-analysis', async () => {
    const complaint = await pending();
    const findComplaint = Complaint.findById.bind(Complaint);
    vi.spyOn(Complaint, 'findById').mockImplementationOnce(async (...args) => {
      const snapshot = await findComplaint(...args);
      await Complaint.updateOne({ _id: complaint._id }, { $set: { status: 'IN_REVIEW' }, $inc: { __v: 1 } });
      return snapshot;
    });
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COMPLAINT_NOT_EDITABLE');
    const stored = await Complaint.findById(complaint.id);
    expect(stored.description).toBe('Large pothole near the bus stop');
    expect(stored.editHistory).toHaveLength(0);
    expect(stored.ai.summary).toBe('old summary');
    expect(await jobs()).toBe(0);
  });

  it('reports STALE_COMPLAINT when another pending change lands during re-analysis', async () => {
    const complaint = await pending();
    const findComplaint = Complaint.findById.bind(Complaint);
    vi.spyOn(Complaint, 'findById').mockImplementationOnce(async (...args) => {
      const snapshot = await findComplaint(...args);
      await Complaint.updateOne({ _id: complaint._id }, { $inc: { __v: 1 } });
      return snapshot;
    });
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    expect((await Complaint.findById(complaint.id)).editHistory).toHaveLength(0);
    expect(await jobs()).toBe(0);
  });

  it('rejects a stale expectedVersion before writing a job', async () => {
    const complaint = await pending();
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop', expectedVersion: complaint.__v + 1 });
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    expect(await jobs()).toBe(0);
  });

  it('enforces the re-analysis limit', async () => {
    const complaint = await pending({ ai: { summary: 'x', tags: [], analysisCount: 6 } });
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EDIT_LIMIT_REACHED');
    expect(await jobs()).toBe(0);
    const locationOnly = await edit(complaint, { location: { address: 'Still editable location' } });
    expect(locationOnly.status).toBe(200);
  });

  it('enforces the total edit limit and reports it in canEdit', async () => {
    const editHistory = Array.from({ length: 20 }, () => ({
      editedAt: new Date(), editedBy: { userId: user._id, displayName: 'x', role: 'citizen' }, fields: ['location'], reanalysed: false,
    }));
    const complaint = await pending({ editHistory });
    const response = await edit(complaint, { location: { address: 'Another spot entirely' } });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EDIT_LIMIT_REACHED');
    const read = await agent.get(`/api/v1/complaints/${complaint.id}`);
    expect(read.body.complaint.canEdit).toBe(false);
  });

  it('increments a legacy complaint without an analysis count from zero', async () => {
    const complaint = await pending({ ai: { summary: 'legacy', tags: [] } });
    await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect((await Complaint.findById(complaint.id)).ai.analysisCount).toBe(1);
  });

  it.each(['citizen', 'admin', 'agency'])('forbids a non-reporter %s', async (role) => {
    const complaint = await pending();
    const { agent: stranger } = await createAuthenticatedAgent({ role });
    const response = await unsafeRequest(stranger, 'patch', `/api/v1/complaints/${complaint.id}`).send({ location: { address: 'Elsewhere road' } });
    expect(response.status).toBe(403);
    expect((await Complaint.findById(complaint.id)).location.address).toBe('Bus stop, Ikeja');
  });

});
