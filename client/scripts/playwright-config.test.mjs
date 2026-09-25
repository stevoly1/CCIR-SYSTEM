// @vitest-environment node
const load = async (env) => {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return (await import('../playwright.config.js')).default;
};

describe('Playwright config in CI', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('refuses a focused test (test.only) under CI, and never retries', async () => {
        const config = await load({ CI: 'true' });
        expect(config.forbidOnly).toBe(true);
        expect(config.retries).toBe(0);
    });

    it('allows focusing locally', async () => {
        expect((await load({ CI: '' })).forbidOnly).toBe(false);
    });

    it('writes JSON results where PLAYWRIGHT_RESULTS_FILE points, keeping the line output', async () => {
        const config = await load({ PLAYWRIGHT_RESULTS_FILE: '/tmp/r/e2e-chrome.json' });
        expect(config.reporter).toEqual([['line'], ['json', { outputFile: '/tmp/r/e2e-chrome.json' }]]);
    });

    it('keeps the plain line output otherwise', async () => {
        expect((await load({ PLAYWRIGHT_RESULTS_FILE: '' })).reporter).toBe('line');
    });
});
