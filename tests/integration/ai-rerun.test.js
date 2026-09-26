const { Category, Complaint, OutboxEntry, SchedulerLease } = require('../../models');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createCategoryFixture } = require('../fixtures/category');
const { enqueueClassification } = require('../../services/classificationRequests');
const { sweepFailedClassifications, claimDailySweep } = require('../../services/jobs/aiSweep');
const { resetAiConfig } = require('../../config/ai');
const { inTransaction } = require('../../utils/transaction');
const { drainOutbox } = require('../helpers/jobs');
const { fakeClassification } = require('../helpers/ai');
const { AiError } = require('../../services/ai/aiError');

const DAY = 24 * 60 * 60 * 1000;
let other;
beforeEach(async () => {
  other = await Category.findOne({ name: 'Other' }) ?? await createCategoryFixture({ name: 'Other', defaultPriority: 'LOW' });
  await createCategoryFixture({ name: 'Roads', defaultPriority: 'HIGH' });
});

const failedReport = async (code = 'PROVIDER_DOWN', failedAt = new Date(Date.now() - 2 * DAY), overrides = {}) => {
  const complaint = await createComplaintFixture({
    category: other._id, categorySnapshot: { categoryId: other._id, name: 'Other' },
    categorySource: 'PENDING', priority: 'LOW', prioritySource: 'CATEGORY_DEFAULT',
    ai: { status: 'PENDING', requestSeq: 1, analysisCount: 1 }, ...overrides,
  });
  await inTransaction((session) => enqueueClassification(session, complaint));
  fakeClassification(AiError.of(code === 'PROVIDER_DOWN' ? 'AUTH' : code));
  await drainOutbox();
  await Complaint.updateOne({ _id: complaint._id }, { $set: { 'ai.failureCode': code, 'ai.failedAt': failedAt } });
  vi.restoreAllMocks();
  return complaint;
};
const reclassify = (agent, id) => unsafeRequest(agent, 'post', `/api/v1/complaints/${id}/reclassify`).send({});

describe('administrator reclassification', () => {
  it('asks again, retires the old failed job, and replaces the fallback on success', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const complaint = await failedReport();
    const response = await reclassify(agent, complaint._id);
    expect(response.status).toBe(202);
    expect(response.body.complaint).toMatchObject({ ai: { status: 'PENDING', requestSeq: 2 }, canReclassify: false });
    expect(await OutboxEntry.findOne({ type: 'classify_report', 'refs.requestSeq': 1 })).toMatchObject({ state: 'DISMISSED', dismissReason: 'Replaced by a newer classification request' });
    fakeClassification({ category: 'Roads' });
    await drainOutbox();
    expect(await Complaint.findById(complaint._id).lean()).toMatchObject({ categorySource: 'AI', categorySnapshot: { name: 'Roads' }, ai: { status: 'DONE', requestSeq: 2 } });
  });

  it('refuses pending, withdrawn and unconfigured requests without writing jobs', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const pending = await createComplaintFixture({ ai: { status: 'PENDING', requestSeq: 1 } });
    expect((await reclassify(agent, pending._id)).body.error.code).toBe('CLASSIFICATION_PENDING');
    const withdrawn = await failedReport('PROVIDER_DOWN', undefined, { status: 'WITHDRAWN' });
    expect((await reclassify(agent, withdrawn._id)).body.error.code).toBe('COMPLAINT_WITHDRAWN');
    const unconfigured = await failedReport();
    const saved = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = '';
    resetAiConfig();
    try {
      const response = await reclassify(agent, unconfigured._id);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('AI_NOT_CONFIGURED');
    } finally {
      process.env.AI_PROVIDER = saved;
      resetAiConfig();
    }
    expect(await OutboxEntry.countDocuments({ type: 'classify_report', 'refs.requestSeq': 2 })).toBe(0);
  });

  it('allows only administrators and does not disclose a missing report to other roles', async () => {
    const complaint = await failedReport();
    for (const role of ['agency', 'citizen']) {
      const { agent } = await createAuthenticatedAgent({ role });
      expect((await reclassify(agent, complaint._id)).status).toBe(403);
    }
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    expect((await reclassify(agent, '66f1a0c0a1b2c3d4e5f60099')).status).toBe(404);
  });

  it('never replaces a staff category or priority with the rerun answer', async () => {
    const roads = await Category.findOne({ name: 'Roads' });
    const complaint = await failedReport('PROVIDER_DOWN', undefined, {
      category: roads._id, categorySnapshot: { categoryId: roads._id, name: 'Roads' },
      categorySource: 'STAFF', priority: 'CRITICAL', prioritySource: 'STAFF',
    });
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    expect((await reclassify(agent, complaint._id)).status).toBe(202);
    fakeClassification({ category: 'Other', priority: 'LOW' });
    await drainOutbox();
    expect(await Complaint.findById(complaint._id).lean()).toMatchObject({
      category: roads._id, categorySource: 'STAFF', priority: 'CRITICAL', prioritySource: 'STAFF',
      ai: { status: 'DONE', suggestedCategory: 'Other' },
    });
  });
});

describe('daily failed-classification sweep', () => {
  it('requeues only retryable failures older than a day and leaves withdrawn reports alone', async () => {
    const old = await failedReport('TIMEOUT', new Date(Date.now() - 3 * DAY));
    const recent = await failedReport('PROVIDER_DOWN', new Date(Date.now() - 3600 * 1000));
    const refused = await failedReport('REFUSED', new Date(Date.now() - 3 * DAY));
    const withdrawn = await failedReport('RATE_LIMITED', new Date(Date.now() - 3 * DAY), { status: 'WITHDRAWN' });
    expect(await sweepFailedClassifications({ now: new Date() })).toEqual({ requeued: 1 });
    expect((await Complaint.findById(old._id)).ai).toMatchObject({ status: 'PENDING', requestSeq: 2 });
    for (const untouched of [recent, refused, withdrawn]) expect((await Complaint.findById(untouched._id)).ai.status).toBe('FAILED');
  });

  it('stops at the limit', async () => {
    for (let i = 0; i < 3; i += 1) await failedReport('TIMEOUT', new Date(Date.now() - (3 + i) * DAY));
    expect(await sweepFailedClassifications({ now: new Date(), limit: 2 })).toEqual({ requeued: 2 });
  });

  it('does not requeue a report withdrawn after candidate selection', async () => {
    const complaint = await failedReport('TIMEOUT', new Date(Date.now() - 3 * DAY));
    const candidate = { _id: complaint._id, ai: { requestSeq: 1 } };
    await Complaint.updateOne({ _id: complaint._id }, { $set: { status: 'WITHDRAWN' } });
    vi.spyOn(Complaint, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ select: async () => [candidate] }) }) });
    expect(await sweepFailedClassifications({ now: new Date() })).toEqual({ requeued: 0 });
    expect((await Complaint.findById(complaint._id)).ai).toMatchObject({ status: 'FAILED', requestSeq: 1 });
    expect(await OutboxEntry.countDocuments({ type: 'classify_report', 'refs.requestSeq': 2 })).toBe(0);
  });

  it('claims once a day across competing processes', async () => {
    const now = new Date();
    const claims = await Promise.all([claimDailySweep(now, 'a'), claimDailySweep(now, 'b'), claimDailySweep(now, 'c')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimDailySweep(new Date(now.getTime() + DAY - 1000), 'a')).toBe(false);
    expect(await claimDailySweep(new Date(now.getTime() + DAY + 1000), 'a')).toBe(true);
    expect(await SchedulerLease.findById('ai-sweep')).toMatchObject({ holder: 'a' });
  });
});
