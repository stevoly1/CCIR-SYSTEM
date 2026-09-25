const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { summarize, problems } = require('../../scripts/ci/checkTestResults');

const vitest = (overrides = {}) => ({
  numTotalTests: 10, numPassedTests: 10, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, ...overrides,
});
const playwright = (stats = {}) => ({ stats: { expected: 11, unexpected: 0, flaky: 0, skipped: 0, ...stats } });

// Vitest and Playwright exit 0 when tests are skipped; CI must not pass a run that silently
// skipped something (the backup rehearsal skips itself without MongoDB Database Tools).
describe('test-results check', () => {
  it('passes a complete, clean run of either tool', () => {
    expect(problems(summarize(vitest()))).toEqual([]);
    expect(problems(summarize(playwright()))).toEqual([]);
  });

  it.each([
    [vitest({ numPendingTests: 2 }), '2 skipped'],
    [vitest({ numTodoTests: 1 }), '1 todo'],
    [vitest({ numFailedTests: 1, success: false }), '1 failed'],
    [vitest({ success: false }), 'the run reported errors'],
    [vitest({ numTotalTests: 0, numPassedTests: 0 }), 'no tests ran'],
    [playwright({ skipped: 1 }), '1 skipped'],
    [playwright({ flaky: 1 }), '1 flaky'],
    [playwright({ unexpected: 2 }), '2 failed'],
    [playwright({ expected: 0 }), 'no tests ran'],
  ])('flags %j', (report, message) => {
    expect(problems(summarize(report))).toContain(message);
  });

  it('does not recognise other files', () => {
    expect(summarize({ hello: 'world' })).toBeNull();
  });

  describe('command', () => {
    const script = path.resolve(__dirname, '../../scripts/ci/checkTestResults.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-results-'));
    const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
    const run = (...files) => spawnSync(process.execPath, [script, ...files], { encoding: 'utf8' });

    it('exits 0 when every file is clean', () => {
      expect(run(write('a.json', vitest()), write('b.json', playwright())).status).toBe(0);
    });

    it('exits 1 naming the file and the problem', () => {
      const result = run(write('c.json', vitest({ numPendingTests: 3 })));
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/c\.json: 3 skipped/);
    });

    it('exits 1 for a missing file, an unrecognised file, or no file at all', () => {
      expect(run(path.join(dir, 'missing.json')).stderr).toContain('results file missing');
      expect(run(write('d.json', { hello: 1 })).stderr).toContain('not a Vitest or Playwright results file');
      expect(run().status).toBe(1);
    });
  });
});
