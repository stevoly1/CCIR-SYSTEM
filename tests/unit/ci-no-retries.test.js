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
// An explicit 0 is allowed (client/playwright.config.js states it).
const RETRY_OPTION = /\bretr(?:y|ies)\s*:\s*(?!0\b)\S/;
// This file's own examples would trip the check.
const SELF = path.relative(root, __filename).split(path.sep).join('/');
const COMMANDS = ['package.json', 'client/package.json', '.github/workflows/ci.yml'];
const RETRY_FLAG = /--retr(?:y|ies)(?:=|\s+)(?!0\b)\S/;

describe('no test retries', () => {
  it('finds the test files it guards', () => {
    expect(tracked.filter((file) => TEST_CODE.test(file)).length).toBeGreaterThan(100);
  });

  it('recognises every way to ask for retries', () => {
    for (const text of ['{ retry: 2 }', "it('x', { retry: 3 }, fn)", 'retries: 1', 'test.describe.configure({ retries: 2 })', 'retry: count']) {
      expect(RETRY_OPTION.test(text), text).toBe(true);
    }
    for (const text of ['retries: 0,', '{ retry: 0 }']) expect(RETRY_OPTION.test(text), text).toBe(false);
    for (const text of ['vitest run --retry=2', 'playwright test --retries 1']) expect(RETRY_FLAG.test(text), text).toBe(true);
    for (const text of ['vitest run --retry=0', 'playwright test --retries 0']) expect(RETRY_FLAG.test(text), text).toBe(false);
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
      .map((line, i) => (RETRY_FLAG.test(line) ? `${file}:${i + 1}` : null))
      .filter(Boolean));
    expect(offending).toEqual([]);
  });
});
