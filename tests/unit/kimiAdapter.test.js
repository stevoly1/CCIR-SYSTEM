const { startFakeKimi, completion, failure } = require('../helpers/fakeKimi.cjs');
const { createKimiAdapter } = require('../../services/ai/adapters/kimi');

let kimi;
beforeAll(async () => { kimi = await startFakeKimi(); });
afterAll(() => kimi.stop());
beforeEach(() => { kimi.requests.length = 0; });

const adapter = (timeoutMs = 1000) => createKimiAdapter({ apiKey: 'test-key', model: 'kimi-test', baseUrl: kimi.url, timeoutMs });
const ask = (options = {}, timeoutMs) => adapter(timeoutMs).complete({ system: 'SYS', user: 'USER', ...options });

describe('Kimi adapter', () => {
  it('sends one JSON-mode request with thinking off and returns the text', async () => {
    kimi.respondWith(() => completion('{"ok":true}'));
    await expect(ask()).resolves.toBe('{"ok":true}');
    const [request] = kimi.requests;
    expect(kimi.requests).toHaveLength(1);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/chat/completions');
    expect(request.headers.authorization).toBe('Bearer test-key');
    expect(request.body).toEqual({
      model: 'kimi-test',
      messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    });
  });

  it('sends a photo as a base64 image part before the text', async () => {
    kimi.respondWith(() => completion('{}'));
    await ask({ image: { mimeType: 'image/jpeg', data: Buffer.from('jpeg-bytes') } });
    expect(kimi.requests[0].body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}` } },
      { type: 'text', text: 'USER' },
    ]);
  });

  it.each([
    [failure(400, 'content_filter'), 'REFUSED'],
    [failure(400, 'invalid_request_error'), 'REFUSED'],
    [failure(422, 'whatever'), 'REFUSED'],
    [failure(401, 'invalid_authentication_error'), 'AUTH'],
    [failure(403, 'permission_denied_error'), 'AUTH'],
    [failure(404, 'resource_not_found_error'), 'AUTH'],
    [failure(500, 'server_error'), 'PROVIDER_DOWN'],
    [failure(502, 'bad_gateway'), 'PROVIDER_DOWN'],
    [failure(503, 'server_unavailable'), 'PROVIDER_DOWN'],
    [completion('{"a":1}', 'content_filter'), 'REFUSED'],
    [completion('{"a":', 'length'), 'INVALID_OUTPUT'],
    [{ status: 200, body: { choices: [] } }, 'INVALID_OUTPUT'],
    [{ status: 200, rawBody: 'not json' }, 'INVALID_OUTPUT'],
    [{ status: 200, rawBody: '' }, 'INVALID_OUTPUT'],
  ])('maps %o to %s', async (answer, code) => {
    kimi.respondWith(() => answer);
    await expect(ask()).rejects.toMatchObject({ name: 'AiError', code });
  });

  it('reads Retry-After in seconds or as a date', async () => {
    kimi.respondWith(() => failure(429, 'rate_limit_reached_error', { 'retry-after': '7' }));
    await expect(ask()).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 7000 });
    kimi.respondWith(() => failure(429, 'rate_limit_reached_error', { 'retry-after': new Date(Date.now() + 10000).toUTCString() }));
    const dated = await ask().catch((error) => error);
    expect(dated.retryAfterMs).toBeGreaterThan(7000);
    expect(dated.retryAfterMs).toBeLessThanOrEqual(10000);
    kimi.respondWith(() => failure(429, 'engine_overloaded_error'));
    await expect(ask()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(ask()).rejects.not.toHaveProperty('retryAfterMs');
  });

  it('waits at least an hour when the account balance is spent', async () => {
    kimi.respondWith(() => failure(429, 'exceeded_current_quota_error', { 'retry-after': '5' }));
    await expect(ask()).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 3600 * 1000 });
  });

  it('times out a provider that never answers and one whose body stalls', async () => {
    kimi.respondWith(() => ({ hang: true }));
    await expect(ask({}, 200)).rejects.toMatchObject({ code: 'TIMEOUT' });
    kimi.respondWith(() => ({ ...completion('{}'), bodyDelayMs: 1000 }));
    await expect(ask({}, 200)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports a stalled error body as a timeout', async () => {
    kimi.respondWith(() => ({ ...failure(429, 'rate_limit_reached_error'), bodyDelayMs: 1000 }));
    await expect(ask({}, 200)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports an unreachable provider as down without quoting the key', async () => {
    const offline = createKimiAdapter({ apiKey: 'sk-secret', model: 'kimi-test', baseUrl: 'http://127.0.0.1:9/v1', timeoutMs: 1000 });
    const error = await offline.complete({ system: 'S', user: 'U' }).catch((cause) => cause);
    expect(error).toMatchObject({ code: 'PROVIDER_DOWN' });
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain('sk-secret');
  });
});
