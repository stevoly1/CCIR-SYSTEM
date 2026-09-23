const { Complaint } = require('../../models');
const aiService = require('../../services/aiService');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const { createComplaintFixture } = require('../fixtures/complaint');

const aiOk = (category, priority) => ({ category, priority, summary: `new ${category}`, tags: [category.toLowerCase()], confidence: 0.8, error: null });

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
    priority: 'HIGH',
    prioritySource: 'AI',
    ai: { suggestedCategory: 'Roads', confidence: 0.9, summary: 'old summary', tags: ['road'], classifiedAt: new Date('2026-09-01'), inputMode: 'TEXT_AND_IMAGE', analysisCount: 1 },
    location: { address: 'Bus stop, Ikeja' },
    ...overrides,
  });
  const edit = (complaint, body) => unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint.id}`).send(body);

  it('re-analyses a material change and replaces every AI-derived field', async () => {
    const complaint = await pending();
    const classify = vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(aiOk('Drainage', 'MEDIUM'));
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });

    expect(response.status).toBe(200);
    expect(response.body.reanalysed).toBe(true);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0][0]).toMatchObject({ description: 'Blocked drain flooding the bus stop' });
    expect(classify.mock.calls[0][0].imageTempFilePath).toBeUndefined();
    const stored = await Complaint.findById(complaint.id);
    expect(String(stored.category)).toBe(drainage.id);
    expect(stored.categorySnapshot.toObject()).toEqual({ categoryId: drainage._id, name: 'Drainage' });
    expect(stored).toMatchObject({ description: 'Blocked drain flooding the bus stop', priority: 'MEDIUM', prioritySource: 'AI' });
    expect(stored.ai).toMatchObject({ summary: 'new Drainage', tags: ['drainage'], suggestedCategory: 'Drainage', confidence: 0.8, inputMode: 'TEXT_ONLY', analysisCount: 2 });
    expect(stored.ai.error).toBeNull();
    expect(stored.ai.classifiedAt.getTime()).toBeGreaterThan(new Date('2026-09-01').getTime());
    expect(stored.editHistory).toHaveLength(1);
    expect(stored.editHistory[0]).toMatchObject({ fields: ['description'], reanalysed: true });
    expect(String(stored.editHistory[0].editedBy.userId)).toBe(user.id);
    expect(stored.__v).toBe(complaint.__v + 1);
  });

  it('replaces AI fields with the fallback when re-analysis fails', async () => {
    const complaint = await pending();
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue({ category: 'Other', priority: 'MEDIUM', summary: '', tags: [], confidence: 0, error: 'TIMEOUT' });
    await edit(complaint, { description: 'Something different entirely now' });
    const stored = await Complaint.findById(complaint.id);
    expect(String(stored.category)).toBe(other.id);
    expect(stored).toMatchObject({ priority: 'LOW', prioritySource: 'CATEGORY_DEFAULT' });
    expect(stored.ai).toMatchObject({ summary: '', tags: [], error: 'TIMEOUT', suggestedCategory: 'Other' });
    expect(stored.editHistory[0].aiError).toBe('TIMEOUT');
  });

  it('keeps a staff-set priority through re-analysis', async () => {
    const complaint = await pending({ priority: 'CRITICAL', prioritySource: 'STAFF' });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(aiOk('Drainage', 'LOW'));
    await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    const stored = await Complaint.findById(complaint.id);
    expect(stored).toMatchObject({ priority: 'CRITICAL', prioritySource: 'STAFF' });
    expect(String(stored.category)).toBe(drainage.id);
  });

  it.each([
    ['whitespace-only description', { description: '  Large   pothole near the bus stop ' }, ['description']],
    ['location-only', { location: { address: 'Opposite the bus stop, Ikeja' } }, ['location']],
  ])('does not re-analyse a %s edit', async (_label, body, fields) => {
    const complaint = await pending();
    const classify = vi.spyOn(aiService, 'classifyComplaint');
    const response = await edit(complaint, body);
    expect(response.status).toBe(200);
    expect(response.body.reanalysed).toBe(false);
    expect(classify).not.toHaveBeenCalled();
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
  });

  it('refuses non-pending complaints before calling AI', async () => {
    const complaint = await pending({ status: 'IN_REVIEW' });
    const classify = vi.spyOn(aiService, 'classifyComplaint');
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COMPLAINT_NOT_EDITABLE');
    expect(classify).not.toHaveBeenCalled();
  });

  it('writes nothing when staff move the complaint during re-analysis', async () => {
    const complaint = await pending();
    vi.spyOn(aiService, 'classifyComplaint').mockImplementation(async () => {
      await Complaint.updateOne({ _id: complaint._id }, { $set: { status: 'IN_REVIEW' }, $inc: { __v: 1 } });
      return aiOk('Drainage', 'MEDIUM');
    });
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COMPLAINT_NOT_EDITABLE');
    const stored = await Complaint.findById(complaint.id);
    expect(stored.description).toBe('Large pothole near the bus stop');
    expect(stored.editHistory).toHaveLength(0);
    expect(stored.ai.summary).toBe('old summary');
  });

  it('reports STALE_COMPLAINT when another pending change lands during re-analysis', async () => {
    const complaint = await pending();
    vi.spyOn(aiService, 'classifyComplaint').mockImplementation(async () => {
      await Complaint.updateOne({ _id: complaint._id }, { $inc: { __v: 1 } });
      return aiOk('Drainage', 'MEDIUM');
    });
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    expect((await Complaint.findById(complaint.id)).editHistory).toHaveLength(0);
  });

  it('rejects a stale expectedVersion before calling AI', async () => {
    const complaint = await pending();
    const classify = vi.spyOn(aiService, 'classifyComplaint');
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop', expectedVersion: complaint.__v + 1 });
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    expect(classify).not.toHaveBeenCalled();
  });

  it('enforces the re-analysis limit', async () => {
    const complaint = await pending({ ai: { summary: 'x', tags: [], analysisCount: 6 } });
    const classify = vi.spyOn(aiService, 'classifyComplaint');
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EDIT_LIMIT_REACHED');
    expect(classify).not.toHaveBeenCalled();
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

  it('counts a legacy complaint without an analysis count as analysed once', async () => {
    const complaint = await pending({ ai: { summary: 'legacy', tags: [] } });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(aiOk('Drainage', 'MEDIUM'));
    await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect((await Complaint.findById(complaint.id)).ai.analysisCount).toBe(2);
  });

  it('fails safely before calling AI when active Other is missing', async () => {
    await other.updateOne({ $set: { isActive: false } });
    const complaint = await pending();
    const classify = vi.spyOn(aiService, 'classifyComplaint');
    const response = await edit(complaint, { description: 'Blocked drain flooding the bus stop' });
    expect(response.status).toBe(500);
    expect(classify).not.toHaveBeenCalled();
    const stored = await Complaint.findById(complaint.id);
    expect(stored.description).toBe('Large pothole near the bus stop');
    expect(stored.editHistory).toHaveLength(0);
  });

  it.each(['citizen', 'admin', 'agency'])('forbids a non-reporter %s', async (role) => {
    const complaint = await pending();
    const { agent: stranger } = await createAuthenticatedAgent({ role });
    const response = await unsafeRequest(stranger, 'patch', `/api/v1/complaints/${complaint.id}`).send({ location: { address: 'Elsewhere road' } });
    expect(response.status).toBe(403);
    expect((await Complaint.findById(complaint.id)).location.address).toBe('Bus stop, Ikeja');
  });

  it('records the new fields when a complaint is created', async () => {
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue(aiOk('Roads', 'HIGH'));
    await unsafeRequest(agent, 'post', '/api/v1/complaints').send({ description: 'Pothole damaging tyres on the bypass', address: '1 Bypass Road' });
    const created = await Complaint.findOne({ description: 'Pothole damaging tyres on the bypass' });
    expect(created).toMatchObject({ prioritySource: 'AI', ai: { inputMode: 'TEXT_ONLY', analysisCount: 1 } });
    expect(created.editHistory).toHaveLength(0);
  });
});
