const fs = require('node:fs');

// Two integration runs at once used to share one fixed record folder, and each cleared the
// other's records at start-up. Each run now records into a folder of its own.
describe('OpenAPI record folder', () => {
  it('gives each run its own folder, used by the recorder, and removes it at teardown', async () => {
    const { default: setup } = await import('../setup/openapiCoverage.mjs');
    const { recordDir } = require('../../middleware/openapiResponseValidator');
    vi.stubEnv('OPENAPI_COVERAGE', '');
    vi.stubEnv('OPENAPI_RECORD_DIR', ''); // restored after the test

    const teardownFirst = setup();
    const first = process.env.OPENAPI_RECORD_DIR;
    expect(recordDir()).toBe(first);
    const teardownSecond = setup();
    const second = process.env.OPENAPI_RECORD_DIR;

    expect(second).not.toBe(first);
    expect(fs.existsSync(first) && fs.existsSync(second)).toBe(true);
    teardownSecond();
    expect(fs.existsSync(second)).toBe(false);
    expect(fs.existsSync(first)).toBe(true);
    process.env.OPENAPI_RECORD_DIR = first;
    teardownFirst();
    expect(fs.existsSync(first)).toBe(false);
  });
});
