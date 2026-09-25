const { captureLogs } = require('../helpers/captureLogs');

const ORIGINAL_API_KEY = process.env.GOOGLE_API_KEY;
const ORIGINAL_TIMEOUT = process.env.AI_TIMEOUT_MS;
const ORIGINAL_MODEL = process.env.GEMINI_MODEL;

const loadService = () => {
  vi.resetModules();
  delete require.cache[require.resolve('../../services/aiService')];
  return require('../../services/aiService');
};

const providerResponse = (rawText) => ({
  ok: true,
  json: vi.fn().mockResolvedValue({
    candidates: [{ content: { parts: [{ text: rawText }] } }],
  }),
});

const validOutput = (overrides = {}) => JSON.stringify({
  category: 'Roads',
  priority: 'HIGH',
  summary: 'Deep pothole blocks the road',
  tags: ['pothole', 'road'],
  confidence: 0.8,
  ...overrides,
});

describe('AI classification contract', () => {
  let logs;
  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'test-key';
    delete process.env.AI_TIMEOUT_MS;
    delete process.env.GEMINI_MODEL;
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (ORIGINAL_API_KEY === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = ORIGINAL_API_KEY;
    if (ORIGINAL_TIMEOUT === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = ORIGINAL_TIMEOUT;
    if (ORIGINAL_MODEL === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = ORIGINAL_MODEL;
  });

  it('parses only integer timeout values within the governed range', () => {
    const { parseAiTimeout } = loadService();

    expect(parseAiTimeout(undefined)).toBe(8000);
    expect(parseAiTimeout('1000')).toBe(1000);
    expect(parseAiTimeout('15000')).toBe(15000);
    for (const value of ['', '999', '15001', '1000.5', 'not-a-number']) {
      expect(() => parseAiTimeout(value)).toThrow(/AI_TIMEOUT_MS/);
    }
  });

  it('rejects invalid timeout configuration when the service loads', () => {
    process.env.AI_TIMEOUT_MS = '999';
    expect(loadService).toThrow(/AI_TIMEOUT_MS/);
  });

  it('aborts the provider request at the configured timeout', async () => {
    vi.useFakeTimers();
    process.env.AI_TIMEOUT_MS = '1000';
    let rejectRequest;
    const fetchMock = vi.fn(() => new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { classifyComplaint } = loadService();

    const resultPromise = classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] });
    vi.advanceTimersByTime(999);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    rejectRequest(Object.assign(new Error('secret provider detail'), { name: 'AbortError' }));

    await expect(resultPromise).resolves.toEqual({
      category: 'Other',
      priority: 'MEDIUM',
      summary: '',
      tags: [],
      confidence: 0,
      error: 'TIMEOUT',
    });
  });

  it('classifies an abort while reading the provider body as a timeout', async () => {
    vi.useFakeTimers();
    process.env.AI_TIMEOUT_MS = '1000';
    let rejectBody;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        rejectBody = reject;
      }),
    }));
    const { classifyComplaint } = loadService();

    const resultPromise = classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] });
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    rejectBody(Object.assign(new Error('private body detail'), { name: 'AbortError' }));

    await expect(resultPromise).resolves.toMatchObject({ error: 'TIMEOUT', category: 'Other' });
  });

  it.each([
    ['network failures', () => Promise.reject(new Error('private network detail')), 'NETWORK_ERROR'],
    ['provider failures', () => Promise.resolve({ ok: false, status: 503 }), 'PROVIDER_ERROR'],
  ])('maps %s to a stable non-sensitive code', async (_name, implementation, errorCode) => {
    vi.stubGlobal('fetch', vi.fn(implementation));
    const { classifyComplaint } = loadService();

    await expect(classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] }))
      .resolves.toMatchObject({ error: errorCode, category: 'Other', confidence: 0 });
    expect(logs.lines).toEqual([expect.objectContaining({ level: 40, errorCode, msg: 'AI classification failed; using the fallback' })]);
    expect(logs.text()).not.toMatch(/private network detail|test-key/);
  });

  it('uses a stable provider fallback when the API key is absent', async () => {
    delete process.env.GOOGLE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { classifyComplaint } = loadService();

    await expect(classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] }))
      .resolves.toMatchObject({ error: 'PROVIDER_ERROR', category: 'Other', confidence: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts only the exact object and returns normalized canonical output', () => {
    const { validateAiOutput } = loadService();

    expect(validateAiOutput(JSON.stringify({
      category: 'Roads',
      priority: 'CRITICAL',
      summary: '  Collapsed bridge blocks traffic  ',
      tags: [' Bridge ', 'DANGER', 'bridge'],
      confidence: 7,
    }), ['Roads', 'Other'])).toEqual({
      category: 'Roads',
      priority: 'CRITICAL',
      summary: 'Collapsed bridge blocks traffic',
      tags: ['bridge', 'danger'],
      confidence: 1,
      error: null,
    });
    expect(validateAiOutput(validOutput({ confidence: -2 }), ['Roads', 'Other']).confidence).toBe(0);
  });

  it.each([
    ['empty content', ''],
    ['markdown fences', `\`\`\`json\n${validOutput()}\n\`\`\``],
    ['malformed JSON', '{"category":'],
    ['unknown fields', validOutput({ explanation: 'extra' })],
    ['unknown category', validOutput({ category: 'Secret Category' })],
    ['invalid priority', validOutput({ priority: 'URGENT' })],
    ['empty summary', validOutput({ summary: '   ' })],
    ['long summary', validOutput({ summary: 's'.repeat(241) })],
    ['too many tags', validOutput({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })],
    ['empty tag', validOutput({ tags: ['road', '   '] })],
    ['long tag', validOutput({ tags: ['x'.repeat(41)] })],
    ['non-array tags', validOutput({ tags: 'road' })],
    ['non-numeric confidence', validOutput({ confidence: '0.8' })],
  ])('rejects %s as complete invalid output', (_name, rawText) => {
    const { validateAiOutput } = loadService();
    expect(() => validateAiOutput(rawText, ['Roads', 'Other'])).toThrow(/invalid AI output/i);
  });

  it('returns identical complete fallbacks for repeated invalid output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(providerResponse('{broken')));
    const { classifyComplaint } = loadService();
    const input = { description: 'pothole', categoryNames: ['Roads', 'Other'] };

    const first = await classifyComplaint(input);
    const second = await classifyComplaint(input);

    expect(first).toEqual(second);
    expect(first).toEqual({
      category: 'Other',
      priority: 'MEDIUM',
      summary: '',
      tags: [],
      confidence: 0,
      error: 'INVALID_OUTPUT',
    });
  });

  it('returns validated output from a successful provider response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(providerResponse(validOutput())));
    const { classifyComplaint } = loadService();

    await expect(classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] }))
      .resolves.toEqual({
        category: 'Roads',
        priority: 'HIGH',
        summary: 'Deep pothole blocks the road',
        tags: ['pothole', 'road'],
        confidence: 0.8,
        error: null,
      });
  });

  it('sends an attached image with the prompt, as base64 with its MIME type', async () => {
    const os = require('node:os');
    const fs = require('node:fs');
    const path = require('node:path');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-ai-test-')), 'photo.png');
    fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(validOutput()));
    vi.stubGlobal('fetch', fetchMock);
    const { classifyComplaint } = loadService();

    await expect(classifyComplaint({ description: 'pothole', imageTempFilePath: file, imageMimeType: 'image/png', categoryNames: ['Roads', 'Other'] }))
      .resolves.toMatchObject({ category: 'Roads', error: null });
    const [{ parts }] = JSON.parse(fetchMock.mock.calls[0][1].body).contents;
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: Buffer.from([1, 2, 3, 4]).toString('base64') } });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('falls back with INVALID_OUTPUT when the provider body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')) }));
    const { classifyComplaint } = loadService();
    await expect(classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] }))
      .resolves.toMatchObject({ error: 'INVALID_OUTPUT', category: 'Other' });
  });

  // Gemini answers "high demand" (503) now and then; one retry within the same time budget avoids
  // most of those fallbacks. Refusals (a bad key, 400/403) and quota limits (429, which reset after
  // up to a minute) are not retried: a retry would only spend more of the quota.
  it.each([
    ['a 503 from the provider', () => Promise.resolve({ ok: false, status: 503 })],
    ['a network failure', () => Promise.reject(new Error('socket hang up'))],
  ])('retries once after %s', async (_name, firstAttempt) => {
    const fetchMock = vi.fn().mockImplementationOnce(firstAttempt).mockResolvedValue(providerResponse(validOutput()));
    vi.stubGlobal('fetch', fetchMock);
    const { classifyComplaint } = loadService();
    await expect(classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] })).resolves.toMatchObject({ category: 'Roads', error: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 403, 429])('does not retry a %s, and logs the provider status', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
    vi.stubGlobal('fetch', fetchMock);
    const { classifyComplaint } = loadService();
    await expect(classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] })).resolves.toMatchObject({ error: 'PROVIDER_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.lines).toEqual([expect.objectContaining({ errorCode: 'PROVIDER_ERROR', providerStatus: status })]);
  });

  it('logs why it fell back when no API key is configured', async () => {
    delete process.env.GOOGLE_API_KEY;
    vi.stubGlobal('fetch', vi.fn());
    const { classifyComplaint } = loadService();
    await classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] });
    expect(logs.lines).toEqual([expect.objectContaining({ level: 40, errorCode: 'PROVIDER_ERROR', reason: 'GOOGLE_API_KEY_MISSING' })]);
  });

  it('sends the key in a header, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(validOutput()));
    vi.stubGlobal('fetch', fetchMock);
    const { classifyComplaint } = loadService();
    await classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain('test-key');
    expect(options.headers['x-goog-api-key']).toBe('test-key');
  });

  // A photo report took 6-7 s at the default thinking level against an 8 s limit; "low" took about 3 s
  // with the same answers. Only Gemini 3 models take thinkingLevel.
  it.each([
    [undefined, { thinkingLevel: 'low' }],
    ['gemini-3.8-flash', { thinkingLevel: 'low' }],
    ['gemini-2.5-flash', undefined],
  ])('asks model %s for a short thinking step where it supports one', async (model, thinkingConfig) => {
    if (model) process.env.GEMINI_MODEL = model;
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(validOutput()));
    vi.stubGlobal('fetch', fetchMock);
    const { classifyComplaint } = loadService();
    await classifyComplaint({ description: 'pothole', categoryNames: ['Roads', 'Other'] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.thinkingConfig).toEqual(thinkingConfig);
  });
});
