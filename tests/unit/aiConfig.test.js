const { parseAiConfig, legacyAiSettings, getAiConfig, resetAiConfig } = require('../../config/ai');

describe('AI settings', () => {
  it('runs without AI when no provider is set', () => {
    expect(parseAiConfig({})).toEqual({
      provider: null,
      configured: false,
      timeoutMs: 20000,
      ratePerMinute: 20,
      disagreementConfidence: 0.7,
      kimi: { apiKey: null, model: 'kimi-k2.6', baseUrl: 'https://api.moonshot.ai/v1' },
    });
  });

  it('is configured only with the provider and its key', () => {
    expect(parseAiConfig({ AI_PROVIDER: 'kimi' }).configured).toBe(false);
    expect(parseAiConfig({ AI_PROVIDER: 'kimi', KIMI_API_KEY: 'k' }).configured).toBe(true);
    expect(parseAiConfig({ KIMI_API_KEY: 'k' }).configured).toBe(false);
  });

  it('reads every setting and trims a trailing slash from the base URL', () => {
    const config = parseAiConfig({
      AI_PROVIDER: 'kimi', KIMI_API_KEY: 'k', KIMI_MODEL: 'kimi-k3', KIMI_BASE_URL: 'http://127.0.0.1:4010/v1/',
      AI_TIMEOUT_MS: '60000', AI_RATE_PER_MINUTE: '600', AI_DISAGREEMENT_CONFIDENCE: '0',
    });
    expect(config).toMatchObject({ timeoutMs: 60000, ratePerMinute: 600, disagreementConfidence: 0, kimi: { model: 'kimi-k3', baseUrl: 'http://127.0.0.1:4010/v1' } });
  });

  it.each([
    [{ AI_PROVIDER: 'gemini' }, 'AI_PROVIDER must be kimi, or unset to run without AI'],
    [{ AI_TIMEOUT_MS: '999' }, 'AI_TIMEOUT_MS must be an integer from 1000 to 60000'],
    [{ AI_TIMEOUT_MS: '60001' }, 'AI_TIMEOUT_MS must be an integer from 1000 to 60000'],
    [{ AI_TIMEOUT_MS: '1e4' }, 'AI_TIMEOUT_MS must be an integer from 1000 to 60000'],
    [{ AI_RATE_PER_MINUTE: '0' }, 'AI_RATE_PER_MINUTE must be an integer from 1 to 600'],
    [{ AI_DISAGREEMENT_CONFIDENCE: '1.5' }, 'AI_DISAGREEMENT_CONFIDENCE must be a number from 0 to 1'],
    [{ AI_DISAGREEMENT_CONFIDENCE: 'high' }, 'AI_DISAGREEMENT_CONFIDENCE must be a number from 0 to 1'],
    [{ KIMI_BASE_URL: 'ftp://x' }, 'KIMI_BASE_URL must be an http or https URL'],
    [{ KIMI_MODEL: 'kimi k2' }, 'KIMI_MODEL must be a model name of letters, digits, dots, dashes and underscores'],
  ])('refuses %o', (env, message) => {
    expect(() => parseAiConfig(env)).toThrow(message);
  });

  it('never quotes the key in an error', () => {
    expect(() => parseAiConfig({ KIMI_API_KEY: 'sk-secret', AI_TIMEOUT_MS: 'x' })).toThrow(/^(?!.*sk-secret)/);
  });

  it('does not treat a whitespace-only key as configured', () => {
    expect(parseAiConfig({ AI_PROVIDER: 'kimi', KIMI_API_KEY: '   ' }).configured).toBe(false);
  });

  it.each(['https://api.moonshot.ai/v1?wrong=1', 'https://api.moonshot.ai/v1?', 'https://api.moonshot.ai/v1#', 'http://127.0.0.1:bad/v1', 'https://user:pass@api.moonshot.ai/v1', 'https://api.moonshot.ai/v1#fragment', ' https://api.moonshot.ai/v1 '])
    ('rejects malformed or ambiguous provider base URL %s', (url) => {
      expect(() => parseAiConfig({ KIMI_BASE_URL: url })).toThrow('KIMI_BASE_URL must be an http or https URL');
    });

  it('names only removed AI settings that are still set', () => {
    expect(legacyAiSettings({ GOOGLE_API_KEY: 'x', GEMINI_MODEL: 'y' })).toEqual(['GOOGLE_API_KEY', 'GEMINI_MODEL']);
    expect(legacyAiSettings({ GOOGLE_CLIENT_ID: 'x' })).toEqual([]);
  });

  it('caches process settings until reset', () => {
    const previous = process.env.AI_PROVIDER;
    try {
      delete process.env.AI_PROVIDER;
      resetAiConfig();
      expect(getAiConfig().provider).toBeNull();
      process.env.AI_PROVIDER = 'kimi';
      expect(getAiConfig().provider).toBeNull();
      resetAiConfig();
      expect(getAiConfig().provider).toBe('kimi');
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previous;
      resetAiConfig();
    }
  });
});
