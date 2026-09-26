const { Category, Complaint, OutboxEntry } = require('../../models');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createCategoryFixture } = require('../fixtures/category');
const { inTransaction } = require('../../utils/transaction');
const { enqueueClassification } = require('../../services/classificationRequests');
const { executeEntry } = require('../../services/jobs/execute');
const { startBackgroundWork } = require('../../services/jobs/background');
const { DEFAULT_POLICY } = require('../../services/jobs/queues');
const { resetAiConfig } = require('../../config/ai');
const { startRedis } = require('../setup/memoryRedis.cjs');
const { startFakeKimi, completion, failure } = require('../helpers/fakeKimi.cjs');

const ANSWER = JSON.stringify({ category: 'Roads', priority: 'HIGH', summary: 'A pothole', tags: ['road'], confidence: 0.9 });
const FAST = { ai: { ...DEFAULT_POLICY.ai, backoffBaseMs: 50, backoffCapMs: 200 } };
let redis;
let kimi;
let work;
const saved = {};

beforeAll(async () => {
  redis = await startRedis();
  kimi = await startFakeKimi();
  for (const name of ['KIMI_BASE_URL', 'AI_TIMEOUT_MS']) saved[name] = process.env[name];
  process.env.KIMI_BASE_URL = kimi.url;
  process.env.AI_TIMEOUT_MS = '1000';
  resetAiConfig();
});
afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetAiConfig();
  await kimi.stop();
  await redis.stop();
});
beforeEach(async () => {
  kimi.requests.length = 0;
  await Category.findOne({ name: 'Other' }) ?? await createCategoryFixture({ name: 'Other' });
  await createCategoryFixture({ name: 'Roads' });
  work = await startBackgroundWork({ env: { REDIS_URL: redis.url }, policy: FAST, relayIntervalMs: 100, heartbeatMs: 60000, sweepIntervalMs: 3600000 });
});
afterEach(async () => work.stop());

const file = async () => {
  const complaint = await createComplaintFixture({ description: 'A deep pothole on Market Road', categorySource: 'PENDING', ai: { status: 'PENDING', requestSeq: 1 } });
  await inTransaction((session) => enqueueClassification(session, complaint));
  return complaint;
};
const settled = (complaint, state) => vi.waitFor(async () => {
  const entry = await OutboxEntry.findOne({ type: 'classify_report', 'refs.complaintId': String(complaint._id) });
  expect(entry.state).toBe(state);
  return entry;
}, { timeout: 15000, interval: 100 });
const script = (...answers) => { let i = 0; kimi.respondWith(() => answers[Math.min(i++, answers.length - 1)]); };

describe('AI failures through Redis, workers and fake Kimi', () => {
  it.each([
    ['a provider that never answers', { hang: true }],
    ['a body that stalls past the time limit', { ...completion(ANSWER), bodyDelayMs: 1500 }],
    ['a server error', failure(500, 'server_error')],
  ])('retries %s, then classifies', async (_, first) => {
    script(first, completion(ANSWER));
    const complaint = await file();
    const entry = await settled(complaint, 'DONE');
    expect(entry.attempts).toBe(2);
    expect(await Complaint.findById(complaint._id).lean()).toMatchObject({ categorySource: 'AI', ai: { status: 'DONE', provider: 'kimi' } });
  });

  it('pauses the whole AI queue for a rate limit, then drains it', async () => {
    script(failure(429, 'rate_limit_reached_error', { 'retry-after': '2' }), completion(ANSWER));
    const first = await file();
    await vi.waitFor(() => expect(kimi.requests).toHaveLength(1), { timeout: 5000, interval: 50 });
    const limitedAt = Date.now();
    const second = await file();
    await settled(first, 'DONE');
    await settled(second, 'DONE');
    expect(kimi.requests.slice(1).every((request) => request.receivedAt >= limitedAt + 1500)).toBe(true);
    expect(Date.now() - limitedAt).toBeGreaterThanOrEqual(1500);
  });

  it.each([
    ['a rejected key', failure(401, 'invalid_authentication_error'), 'AUTH', 1],
    ['a refusal', failure(400, 'content_filter'), 'REFUSED', 1],
    ['an unusable answer, twice', completion('{"category":'), 'INVALID_OUTPUT', 2],
  ])('gives up on %s, leaving the report on Other', async (_, answer, code, calls) => {
    script(answer);
    const complaint = await file();
    const entry = await settled(complaint, 'FAILED');
    expect(entry.lastErrorCode).toBe(code);
    expect(kimi.requests).toHaveLength(calls);
    // The worker records the failed job before its final-failure callback updates the report.
    await vi.waitFor(async () => expect(await Complaint.findById(complaint._id).lean()).toMatchObject({
      categorySource: 'FALLBACK', ai: { status: 'FAILED', failureCode: code },
    }), { timeout: 5000, interval: 50 });
  });

  it('writes one consistent result when the same job is delivered twice at once', async () => {
    await work.stop();
    script(completion(ANSWER));
    const complaint = await file();
    const entry = await OutboxEntry.findOne({ type: 'classify_report' });
    await Promise.all([1, 2].map(() => executeEntry(entry._id, { runKey: 0, attempt: 1, maxAttempts: 6 }).catch(() => {})));
    expect(await Complaint.findById(complaint._id).lean()).toMatchObject({ categorySource: 'AI', ai: { status: 'DONE', requestSeq: 1, suggestedCategory: 'Roads' } });
    expect(await OutboxEntry.findById(entry._id)).toMatchObject({ state: 'DONE', attempts: 1 });
    work = await startBackgroundWork({ env: { REDIS_URL: redis.url }, policy: FAST, relayIntervalMs: 100, heartbeatMs: 60000, sweepIntervalMs: 3600000 });
  });
});
