const { parseAiConfig } = require('../../config/ai');
const ai = require('../../services/ai');
const fakeKimi = require('../helpers/fakeKimi.cjs');

const GOOD = { category: 'Roads', priority: 'HIGH', summary: 'A pothole', tags: ['road'], confidence: 0.8 };

// Each provider supplies only transport vocabulary; every adapter runs the same behavioural cases.
const ADAPTERS = [{
  provider: 'kimi',
  start: () => fakeKimi.startFakeKimi(),
  env: (url) => ({ AI_PROVIDER: 'kimi', KIMI_API_KEY: 'contract-key', KIMI_BASE_URL: url, KIMI_MODEL: 'kimi-contract', AI_TIMEOUT_MS: '1000' }),
  model: (config) => config.kimi.model,
  say: (text) => fakeKimi.completion(text),
  refuse: () => fakeKimi.failure(400, 'content_filter'),
  status: (code, headers) => fakeKimi.failure(code, code === 429 ? 'rate_limit_reached_error' : 'error', headers),
  sawImage: (request) => JSON.stringify(request.body).includes('data:image/jpeg;base64,'),
}];

describe.each(ADAPTERS)('adapter contract: $provider', (adapter) => {
  let fake;
  let config;
  beforeAll(async () => {
    fake = await adapter.start();
    config = parseAiConfig(adapter.env(fake.url));
  });
  afterAll(() => fake.stop());
  const classify = (image) => ai.classifyReport({ description: 'A deep pothole', categories: ['Roads', 'Other'], image }, { config });

  it('returns a checked classification with its provenance', async () => {
    fake.respondWith(() => adapter.say(JSON.stringify(GOOD)));
    const result = await classify();
    expect(result).toMatchObject({ ...GOOD, meta: { provider: adapter.provider, model: adapter.model(config), promptVersion: 'classify-v1' } });
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends the photo when there is one', async () => {
    fake.respondWith(() => adapter.say(JSON.stringify(GOOD)));
    await classify({ mimeType: 'image/jpeg', data: Buffer.from('x') });
    expect(adapter.sawImage(fake.requests.at(-1))).toBe(true);
  });

  it.each([
    ['malformed JSON', () => adapter.say('{"category":')],
    ['an unknown category', () => adapter.say(JSON.stringify({ ...GOOD, category: 'Parks' }))],
    ['a missing field', () => adapter.say(JSON.stringify({ ...GOOD, tags: undefined }))],
    ['an empty body', () => ({ status: 200, rawBody: '' })],
  ])('refuses %s as INVALID_OUTPUT', async (_, answer) => {
    fake.respondWith(answer);
    await expect(classify()).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it.each([
    ['a timeout', () => ({ hang: true }), 'TIMEOUT'],
    ['a slow body past the timeout', () => ({ ...adapter.say(JSON.stringify(GOOD)), bodyDelayMs: 1500 }), 'TIMEOUT'],
    ['429 with Retry-After', () => adapter.status(429, { 'retry-after': '3' }), 'RATE_LIMITED'],
    ['429 without Retry-After', () => adapter.status(429), 'RATE_LIMITED'],
    ['500', () => adapter.status(500), 'PROVIDER_DOWN'],
    ['502', () => adapter.status(502), 'PROVIDER_DOWN'],
    ['503', () => adapter.status(503), 'PROVIDER_DOWN'],
    ['401', () => adapter.status(401), 'AUTH'],
    ['a refusal', () => adapter.refuse(), 'REFUSED'],
  ])('fails %s as %s', async (_, answer, code) => {
    fake.respondWith(answer);
    await expect(classify()).rejects.toMatchObject({ name: 'AiError', code });
  });

  it('keeps the Retry-After delay', async () => {
    fake.respondWith(() => adapter.status(429, { 'retry-after': '3' }));
    await expect(classify()).rejects.toMatchObject({ retryAfterMs: 3000 });
  });
});
