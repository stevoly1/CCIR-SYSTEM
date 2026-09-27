const { Category, Complaint, OutboxEntry } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createCategoryFixture } = require('../fixtures/category');
const { inTransaction } = require('../../utils/transaction');
const { enqueueClassification } = require('../../services/classificationRequests');
const { drainOutbox } = require('../helpers/jobs');
const { fakeClassification } = require('../helpers/ai');

let roads;
let drainage;
beforeEach(async () => {
  roads = await createCategoryFixture({ name: 'Roads' });
  drainage = await createCategoryFixture({ name: 'Drainage' });
});
const recategorise = (agent, complaint, body) => unsafeRequest(agent, 'patch', `/api/v1/complaints/${complaint._id}/category`).send(body);
const reason = 'The photo shows a blocked drain, not the road';

describe('staff recategorisation', () => {
  it('sets a durable staff category and records the reason only for staff', async () => {
    const { agent: admin } = await createAuthenticatedAgent({ role: 'admin' });
    const { agent: citizenAgent, user: citizen } = await createAuthenticatedAgent({ role: 'citizen' });
    const complaint = await createComplaintFixture({
      reporter: citizen._id, category: roads._id, categorySnapshot: { categoryId: roads._id, name: 'Roads' }, categorySource: 'CITIZEN',
      citizenCategory: { categoryId: roads._id, name: 'Roads' }, priority: 'HIGH', prioritySource: 'AI',
      ai: { status: 'DONE', requestSeq: 1, disagreement: { categoryId: drainage._id, name: 'Drainage', confidence: 0.9 } },
    });
    const response = await recategorise(admin, complaint, { categoryId: String(drainage._id), reason, expectedVersion: complaint.__v });
    expect(response.status).toBe(200);
    const saved = await Complaint.findById(complaint._id).lean();
    expect(saved).toMatchObject({ category: drainage._id, categorySnapshot: { name: 'Drainage' }, categorySource: 'STAFF', priority: 'HIGH', citizenCategory: { name: 'Roads' } });
    expect(saved.ai.disagreement).toBeUndefined();
    expect(saved.statusHistory.at(-1)).toMatchObject({ type: 'CATEGORY_CHANGED', internalNote: reason, categoryChange: { from: { name: 'Roads' }, to: { name: 'Drainage' } } });
    expect(await OutboxEntry.countDocuments({ type: 'status_update' })).toBe(0);
    expect(response.body.complaint.timeline.at(-1)).toMatchObject({ type: 'CATEGORY_CHANGED', internalNote: reason, categoryChange: { from: { name: 'Roads' }, to: { name: 'Drainage' } } });

    const own = await citizenAgent.get(`/api/v1/complaints/${complaint._id}`);
    expect(own.status).toBe(200);
    expect(own.body.complaint.category.name).toBe('Drainage');
    expect(own.body.complaint.timeline.map((entry) => entry.type)).not.toContain('CATEGORY_CHANGED');
    expect(JSON.stringify(own.body)).not.toContain(reason);

    await Complaint.updateOne({ _id: complaint._id }, { $set: { 'ai.status': 'PENDING', 'ai.requestSeq': 2 } });
    await inTransaction(async (session) => enqueueClassification(session, await Complaint.findById(complaint._id).session(session)));
    fakeClassification({ category: 'Roads', confidence: 0.99 });
    await drainOutbox();
    expect(await Complaint.findById(complaint._id).lean()).toMatchObject({ category: drainage._id, categorySource: 'STAFF' });
  });

  it('can keep the citizen category only when settling a disagreement', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const flagged = await createComplaintFixture({ category: roads._id, categorySource: 'CITIZEN', ai: { status: 'DONE', requestSeq: 1, disagreement: { categoryId: drainage._id, name: 'Drainage', confidence: 0.8 } } });
    expect((await recategorise(agent, flagged, { categoryId: String(roads._id), reason })).status).toBe(200);
    expect(await Complaint.findById(flagged._id).lean()).toMatchObject({ category: roads._id, categorySource: 'STAFF' });
    const plain = await createComplaintFixture({ category: roads._id, categorySource: 'AI' });
    const refused = await recategorise(agent, plain, { categoryId: String(roads._id), reason });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('CATEGORY_UNCHANGED');
  });

  it('allows only administrators and the assigned agency member', async () => {
    const { agent: assigned, user: assignee } = await createAuthenticatedAgent({ role: 'agency' });
    const { agent: otherAgency } = await createAuthenticatedAgent({ role: 'agency' });
    const { agent: citizen } = await createAuthenticatedAgent({ role: 'citizen' });
    const complaint = await createComplaintFixture({ category: roads._id, categorySource: 'AI', assignedTo: assignee._id, status: 'IN_REVIEW' });
    expect((await recategorise(otherAgency, complaint, { categoryId: String(drainage._id), reason })).body.error.code).toBe('NOT_ASSIGNED_TO_YOU');
    expect((await recategorise(citizen, complaint, { categoryId: String(drainage._id), reason })).status).toBe(403);
    expect((await recategorise(assigned, complaint, { categoryId: String(drainage._id), reason })).status).toBe(200);
  });

  it('does not disclose a withdrawn report to an unassigned agency member', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'agency' });
    const complaint = await createComplaintFixture({ category: roads._id, status: 'WITHDRAWN' });
    const response = await recategorise(agent, complaint, { categoryId: String(drainage._id), reason });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_ASSIGNED_TO_YOU');
  });

  it('refuses an agency decision if assignment changes before the guarded write', async () => {
    const { agent, user: originalAssignee } = await createAuthenticatedAgent({ role: 'agency' });
    const { user: nextAssignee } = await createAuthenticatedAgent({ role: 'agency' });
    const complaint = await createComplaintFixture({ category: roads._id, assignedTo: originalAssignee._id, status: 'IN_REVIEW' });
    const findCategory = Category.findOne.bind(Category);
    vi.spyOn(Category, 'findOne').mockImplementationOnce(async (...args) => {
      const category = await findCategory(...args);
      await Complaint.updateOne({ _id: complaint._id }, { $set: { assignedTo: nextAssignee._id }, $inc: { __v: 1 } });
      return category;
    });
    const response = await recategorise(agent, complaint, { categoryId: String(drainage._id), reason });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_ASSIGNED_TO_YOU');
    const stored = await Complaint.findById(complaint._id);
    expect(stored.category).toEqual(roads._id);
    expect(stored.statusHistory).toHaveLength(0);
  });

  it('refuses a stale staff category decision when AI changed the category without a version increment', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await createComplaintFixture({ category: roads._id, categorySnapshot: { categoryId: roads._id, name: 'Roads' }, categorySource: 'PENDING' });
    const findCategory = Category.findOne.bind(Category);
    vi.spyOn(Category, 'findOne').mockImplementationOnce(async (...args) => {
      const category = await findCategory(...args);
      await Complaint.updateOne({ _id: complaint._id }, { $set: {
        category: drainage._id, categorySnapshot: { categoryId: drainage._id, name: 'Drainage' }, categorySource: 'AI',
      } });
      return category;
    });
    const response = await recategorise(agent, complaint, { categoryId: String(drainage._id), reason, expectedVersion: complaint.__v });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_COMPLAINT');
    const stored = await Complaint.findById(complaint._id).lean();
    expect(stored).toMatchObject({ category: drainage._id, categorySource: 'AI' });
    expect(stored.statusHistory).toHaveLength(0);
  });

  it.each([
    ['withdrawn', { status: 'WITHDRAWN' }, (id) => ({ categoryId: id, reason }), 409, 'COMPLAINT_WITHDRAWN'],
    ['inactive category', {}, () => ({ categoryId: 'inactive', reason }), 409, 'CATEGORY_INACTIVE'],
    ['stale version', {}, (id) => ({ categoryId: id, reason, expectedVersion: 99 }), 409, 'STALE_COMPLAINT'],
    ['short reason', {}, (id) => ({ categoryId: id, reason: 'no' }), 400, undefined],
  ])('refuses %s', async (_, overrides, body, status, code) => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const inactive = await createCategoryFixture({ name: 'Old', isActive: false });
    const complaint = await createComplaintFixture({ category: roads._id, categorySource: 'AI', ...overrides });
    const payload = body(String(drainage._id));
    if (payload.categoryId === 'inactive') payload.categoryId = String(inactive._id);
    const response = await recategorise(agent, complaint, payload);
    expect(response.status).toBe(status);
    if (code) expect(response.body.error.code).toBe(code);
  });
});
