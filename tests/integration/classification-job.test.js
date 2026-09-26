const { Category, Complaint, OutboxEntry } = require('../../models');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createCategoryFixture } = require('../fixtures/category');
const { inTransaction } = require('../../utils/transaction');
const { enqueueClassification, requestClassification, classificationRetry, recordClassificationFailure } = require('../../services/classificationRequests');
const reportPhoto = require('../../services/ai/reportPhoto');
const { AiError } = require('../../services/ai/aiError');
const { JobError } = require('../../services/jobs/jobError');
const { drainOutbox } = require('../helpers/jobs');
const { fakeClassification } = require('../helpers/ai');
const { captureLogs } = require('../helpers/captureLogs');

let other;
let roads;
let drainage;
beforeEach(async () => {
  other = await Category.findOne({ name: 'Other' }) ?? await createCategoryFixture({ name: 'Other', defaultPriority: 'LOW' });
  roads = await createCategoryFixture({ name: 'Roads' });
  drainage = await createCategoryFixture({ name: 'Drainage' });
});

const filed = async (overrides = {}) => {
  const complaint = await createComplaintFixture({
    description: 'A deep pothole on Market Road', category: other._id, categorySnapshot: { categoryId: other._id, name: 'Other' },
    categorySource: 'PENDING', priority: 'LOW', prioritySource: 'CATEGORY_DEFAULT', ai: { status: 'PENDING', requestSeq: 1 }, ...overrides,
  });
  await inTransaction((session) => enqueueClassification(session, complaint));
  return complaint;
};
const reload = (complaint) => Complaint.findById(complaint._id).lean();
const entryFor = (complaint) => OutboxEntry.findOne({ type: 'classify_report', 'refs.complaintId': String(complaint._id) }).sort({ createdAt: -1 });

describe('classify_report', () => {
  it('increments the request and dismisses older failed classification jobs in one transaction', async () => {
    const complaint = await filed();
    const old = await entryFor(complaint);
    await OutboxEntry.updateOne({ _id: old._id }, { $set: { state: 'FAILED', lastErrorCode: 'TIMEOUT' } });
    const requested = await inTransaction((session) => requestClassification({ session, complaintId: complaint._id }));
    expect(requested.ai).toMatchObject({ requestSeq: 2, status: 'PENDING' });
    expect(await OutboxEntry.findById(old._id)).toMatchObject({ state: 'DISMISSED', dismissReason: 'Replaced by a newer classification request' });
    expect(await OutboxEntry.countDocuments({ type: 'classify_report', 'refs.complaintId': String(complaint._id) })).toBe(2);
    expect((await entryFor(complaint)).refs.requestSeq).toBe(2);
  });

  it('reuses the failed entry for a Jobs-page retry and refuses a superseded request', async () => {
    const complaint = await filed();
    const entry = await entryFor(complaint);
    await OutboxEntry.updateOne({ _id: entry._id }, { $set: { state: 'FAILED' } });
    await inTransaction((session) => classificationRetry(entry, session));
    expect((await reload(complaint)).ai.requestSeq).toBe(2);
    expect((await OutboxEntry.findById(entry._id)).refs.requestSeq).toBe(2);
    expect(await OutboxEntry.countDocuments({ type: 'classify_report', 'refs.complaintId': String(complaint._id) })).toBe(1);
    await expect(inTransaction((session) => classificationRetry(entry, session))).rejects.toMatchObject({ code: 'JOB_CANNOT_RETRY' });
    expect((await reload(complaint)).ai.requestSeq).toBe(2);
  });

  it('sets the AI category, priority and provenance on a pending report', async () => {
    fakeClassification({ category: 'Roads', priority: 'HIGH', confidence: 0.8 });
    const complaint = await filed();
    await drainOutbox();
    expect(await reload(complaint)).toMatchObject({
      category: roads._id, categorySource: 'AI', priority: 'HIGH', prioritySource: 'AI',
      ai: { status: 'DONE', requestSeq: 1, suggestedCategory: 'Roads', provider: 'kimi', model: 'kimi-test', promptVersion: 'classify-v1', inputMode: 'TEXT_ONLY' },
    });
    expect((await entryFor(complaint)).state).toBe('DONE');
  });

  it("keeps a citizen's category and flags a confident disagreement", async () => {
    fakeClassification({ category: 'Roads', confidence: 0.9 });
    const complaint = await filed({ category: drainage._id, categorySource: 'CITIZEN', citizenCategory: { categoryId: drainage._id, name: 'Drainage' } });
    await drainOutbox();
    expect(await reload(complaint)).toMatchObject({ category: drainage._id, categorySource: 'CITIZEN', ai: { disagreement: { categoryId: roads._id, name: 'Roads', confidence: 0.9 } } });
  });

  it('sends the photo when the report has one', async () => {
    const classify = fakeClassification({ category: 'Roads' });
    vi.spyOn(reportPhoto, 'readFirstPhoto').mockResolvedValue({ mimeType: 'image/jpeg', data: Buffer.from('x') });
    const complaint = await filed();
    await drainOutbox();
    expect(classify.mock.calls[0][0].image).toEqual({ mimeType: 'image/jpeg', data: Buffer.from('x') });
    expect((await reload(complaint)).ai.inputMode).toBe('TEXT_AND_IMAGE');
  });

  it('drops a result for a request that is no longer current', async () => {
    const classify = fakeClassification({ category: 'Roads' });
    const complaint = await filed();
    await Complaint.updateOne({ _id: complaint._id }, { $set: { 'ai.requestSeq': 2 } });
    await drainOutbox();
    expect(await reload(complaint)).toMatchObject({ category: other._id, categorySource: 'PENDING', ai: { status: 'PENDING' } });
    expect((await entryFor(complaint)).state).toBe('DONE');
    expect(classify).not.toHaveBeenCalled();
  });

  it('never overwrites a staff decision that lands while the AI is answering', async () => {
    const complaint = await filed();
    fakeClassification(async () => {
      await Complaint.updateOne({ _id: complaint._id }, { $set: { category: drainage._id, categorySource: 'STAFF', priority: 'CRITICAL', prioritySource: 'STAFF' } });
      return { category: 'Roads', priority: 'LOW' };
    });
    await drainOutbox();
    expect(await reload(complaint)).toMatchObject({ category: drainage._id, categorySource: 'STAFF', priority: 'CRITICAL', prioritySource: 'STAFF', ai: { status: 'DONE', suggestedCategory: 'Roads' } });
  });

  it('falls back to Other when the AI cannot classify, and says why', async () => {
    fakeClassification(AiError.of('REFUSED'));
    const complaint = await filed();
    await drainOutbox({ maxAttempts: 6 });
    expect(await reload(complaint)).toMatchObject({ category: other._id, categorySource: 'FALLBACK', ai: { status: 'FAILED', failureCode: 'REFUSED' } });
    expect((await reload(complaint)).ai.failedAt).toBeInstanceOf(Date);
    expect(await entryFor(complaint)).toMatchObject({ state: 'FAILED', attempts: 1, lastErrorCode: 'REFUSED' });
  });

  it('does not turn a completed result into a failure from a duplicate delivery', async () => {
    const complaint = await filed();
    await Complaint.updateOne({ _id: complaint._id }, { $set: { 'ai.status': 'DONE', categorySource: 'AI', category: roads._id } });
    await recordClassificationFailure({ complaintId: String(complaint._id), requestSeq: 1 }, 'TIMEOUT');
    expect(await reload(complaint)).toMatchObject({ category: roads._id, categorySource: 'AI', ai: { status: 'DONE' } });
  });

  it("keeps a citizen's category when classification fails", async () => {
    fakeClassification(AiError.of('AUTH'));
    const complaint = await filed({ category: drainage._id, categorySource: 'CITIZEN' });
    await drainOutbox();
    expect(await reload(complaint)).toMatchObject({ category: drainage._id, categorySource: 'CITIZEN', ai: { status: 'FAILED', failureCode: 'AUTH' } });
  });

  it('tries once more after an unusable answer, and stops after a second', async () => {
    const classify = fakeClassification(AiError.of('INVALID_OUTPUT'));
    const complaint = await filed();
    await drainOutbox({ maxAttempts: 6 });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(await entryFor(complaint)).toMatchObject({ state: 'FAILED', attempts: 2, lastErrorCode: 'INVALID_OUTPUT' });
  });

  it('retries a passing failure and keeps the report pending meanwhile', async () => {
    fakeClassification(AiError.of('RATE_LIMITED', { retryAfterMs: 45000 }));
    const complaint = await filed();
    const entry = await entryFor(complaint);
    const { executeEntry } = require('../../services/jobs/execute');
    await executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 6 }).catch(() => {});
    const after = await OutboxEntry.findById(entry._id);
    expect(after).toMatchObject({ state: 'PENDING', lastErrorCode: 'RATE_LIMITED' });
    expect(after.notBefore.getTime() - Date.now()).toBeGreaterThan(40000);
    expect((await reload(complaint)).ai.status).toBe('PENDING');
  });

  it('fails at once without AI, and says so once per process', async () => {
    fakeClassification(AiError.of('NOT_CONFIGURED'));
    const logs = captureLogs();
    try {
      await filed();
      await filed({ referenceCode: 'TEST-NC-2' });
      await drainOutbox({ maxAttempts: 6 });
    } finally { logs.restore(); }
    expect(logs.lines.filter((line) => line.event === 'ai_not_configured').length).toBeLessThanOrEqual(1);
    expect(await Complaint.countDocuments({ 'ai.failureCode': 'NOT_CONFIGURED' })).toBe(2);
  });

  it('logs provider and model, never the report text', async () => {
    fakeClassification({ category: 'Roads' });
    const logs = captureLogs();
    try { await filed(); await drainOutbox(); } finally { logs.restore(); }
    expect(logs.lines.find((line) => line.event === 'job' && line.type === 'classify_report')).toMatchObject({ outcome: 'done', provider: 'kimi', model: 'kimi-test' });
    expect(logs.text()).not.toContain('Market Road');
  });

  it('does not log report text from an unexpected AI-service error', async () => {
    fakeClassification(new Error('Failed to classify A deep pothole on Market Road'));
    const logs = captureLogs();
    try { await filed(); await drainOutbox({ maxAttempts: 1 }); } finally { logs.restore(); }
    expect(logs.lines.find((line) => line.event === 'job' && line.type === 'classify_report')).toMatchObject({ failureCode: 'INTERNAL' });
    expect(logs.text()).not.toContain('Market Road');
  });

  it('keeps a photo retrieval failure retryable without logging photo or report text', async () => {
    vi.spyOn(reportPhoto, 'readFirstPhoto').mockRejectedValueOnce(JobError.of('PROVIDER_DOWN'))
      .mockRejectedValueOnce(new Error('Could not fetch the photo for Market Road'));
    const complaint = await filed();
    const entry = await entryFor(complaint);
    const { executeEntry } = require('../../services/jobs/execute');
    const logs = captureLogs();
    try {
      await executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 6 }).catch(() => {});
      await executeEntry(entry._id, { runKey: 0, attempt: 2, maxAttempts: 6 }).catch(() => {});
    } finally { logs.restore(); }
    expect((await OutboxEntry.findById(entry._id)).lastErrorCode).toBe('INTERNAL');
    expect(logs.lines.filter((line) => line.event === 'job').map((line) => line.failureCode)).toEqual(['PROVIDER_DOWN', 'INTERNAL']);
    expect(logs.text()).not.toContain('Market Road');
  });
});
