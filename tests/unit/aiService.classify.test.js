const { parseAiConfig } = require('../../config/ai');
const ai = require('../../services/ai');

describe('the AI service without a provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([{}, { AI_PROVIDER: 'kimi' }])('answers NOT_CONFIGURED for %o without calling a provider', async (env) => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(ai.classifyReport({ description: 'x', categories: ['Other'] }, { config: parseAiConfig(env) }))
      .rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps an unsupported injected provider as a typed configuration failure', async () => {
    const config = { ...parseAiConfig({ AI_PROVIDER: 'kimi', KIMI_API_KEY: 'test-key' }), provider: 'unknown' };
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(ai.classifyReport({ description: 'x', categories: ['Other'] }, { config }))
      .rejects.toMatchObject({ name: 'AiError', code: 'NOT_CONFIGURED' });
    expect(spy).not.toHaveBeenCalled();
  });
});
