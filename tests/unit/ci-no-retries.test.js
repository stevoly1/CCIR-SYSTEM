const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// A retried test that passes on its second try is flaky, and CI must fail on it. Vitest's JSON
// results do not record retries, so check:test-results cannot see them; CI passes --retry=0, but a
// test's own options or a config setting would override that. So no test, helper or config may
// ask for retries at all.
const root = path.resolve(__dirname, '../..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

const TEST_CODE = /(\.(test|spec)\.[cm]?jsx?$)|(^|\/)(vitest|playwright)[^/]*\.config\.[cm]?js$|^(tests|client\/tests|client\/src\/test)\//;
// A retry or retries option, quoted or not, with any value but an explicit 0 or false
// (client/playwright.config.js states 0), including a value on the next line; or shorthand.
const RETRY_OPTION = /(?:\bretr(?:y|ies)|(['"])retr(?:y|ies)\1)\s*:(?!\s*(?:0|false)\b)|[{,]\s*retr(?:y|ies)\s*[,}]/;
// This file's own examples would trip the check.
const SELF = path.relative(root, __filename).split(path.sep).join('/');
const COMMANDS = ['package.json', 'client/package.json', '.github/workflows/ci.yml'];
// Only on lines that run tests: curl --retry, say, is fine.
const TEST_COMMAND = /\b(?:vitest|playwright)\b|\bnpm\b.*\btest\b/;
const RETRY_FLAG = /--retr(?:y|ies)(?:=|\s+)(?!0\b)\S/;
const CONFIGS = ['vitest.unit.config.mjs', 'vitest.integration.config.mjs', 'vitest.coverage.config.mjs', 'client/vitest.config.js', 'client/playwright.config.js'];

describe('no test retries', () => {
  it('guards every test file and every test configuration', () => {
    const guarded = tracked.filter((file) => TEST_CODE.test(file));
    expect(guarded.length).toBeGreaterThan(100);
    expect(guarded).toEqual(expect.arrayContaining(CONFIGS));
  });

  it('recognises the usual ways to ask for retries', () => {
    for (const text of [
      '{ retry: 2 }', "it('x', { retry: 3 }, fn)", 'retries: 1', 'test.describe.configure({ retries: 2 })', 'retry: count',
      "{ 'retry': 2 }", '{ "retries": 1 }', '{ retry }', 'configure({ retries })', '{ retry, timeout }', '  retry:',
    ]) {
      expect(RETRY_OPTION.test(text), text).toBe(true);
    }
    for (const text of ['retries: 0,', '{ retry: 0 }', 'retry: false', 'retryAfter: 5', 'const retrying = true;', "it('does not retry, or fail, because it changed', fn)"]) {
      expect(RETRY_OPTION.test(text), text).toBe(false);
    }
    const flagged = (line) => TEST_COMMAND.test(line) && RETRY_FLAG.test(line);
    for (const text of ['vitest run --retry=2', 'playwright test --retries 1', 'run: npm run test:coverage -- --retry=3']) expect(flagged(text), text).toBe(true);
    for (const text of ['vitest run --retry=0', 'playwright test --retries 0', 'curl --retry 3 -fsSLo x https://example.test']) expect(flagged(text), text).toBe(false);
  });

  it('no test, helper or config asks for retries', () => {
    const offending = tracked
      .filter((file) => TEST_CODE.test(file) && file !== SELF)
      .flatMap((file) => fs.readFileSync(path.join(root, file), 'utf8').split('\n')
        .map((line, i) => (RETRY_OPTION.test(line) ? `${file}:${i + 1}` : null))
        .filter(Boolean));
    expect(offending).toEqual([]);
  });

  it('no command asks for retries', () => {
    const offending = COMMANDS.flatMap((file) => fs.readFileSync(path.join(root, file), 'utf8').split('\n')
      .map((line, i) => (TEST_COMMAND.test(line) && RETRY_FLAG.test(line) ? `${file}:${i + 1}` : null))
      .filter(Boolean));
    expect(offending).toEqual([]);
  });
});
