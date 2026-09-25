// Guard: the public repository must never hold private records (docs/, tools/), Word files,
// environment files or database backups. CI checks every tracked path and every path any commit in
// history touched, merge commits included, so something added and later removed is still caught.
// Every rule ignores case: macOS file systems do (.ENV is .env).
const { execFileSync } = require('node:child_process');

// A bare "docs" or "tools" is a gitlink: a nested repository added with git add or git submodule add.
const RULES = [
  {
    reason: 'environment file',
    test: (p) => (/(^|\/)\.env(rc)?(?![a-z0-9])/i.test(p) || /[^/]\.env$/i.test(p)) && !/(^|\/)\.env\.example$/i.test(p),
  },
  { reason: 'private records', test: (p) => /^(docs|tools)(\/|$)/i.test(p) },
  { reason: 'Word document', test: (p) => /\.docx$/i.test(p) },
  { reason: 'database backup', test: (p) => /^backups(\/|$)/i.test(p) || /\.archive\.gz$/i.test(p) },
];

const privateReason = (path) => RULES.find((rule) => rule.test(path))?.reason ?? null;

const findPrivatePaths = (paths) => [...new Set(paths)]
  .filter((path) => privateReason(path))
  .sort()
  .map((path) => ({ path, reason: privateReason(path) }));

// -z: names come NUL-separated and verbatim. Without it git quotes names that are not plain ASCII or
// that hold a quote, backslash, tab or newline ("docs/a\"b.md"), which the rules would not recognise.
const gitPaths = (args, cwd) => execFileSync('git', [...args, '-z'], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);

const isShallow = (cwd) => execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd, encoding: 'utf8' }).trim() === 'true';

// Returns the exit code. Options exist so the tests can run it in-process.
const main = ({ cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) => {
  if (isShallow(cwd)) {
    stderr.write('check:tracked-files needs the full history; this clone is shallow (use fetch-depth: 0).\n');
    return 1;
  }
  const found = findPrivatePaths([...gitPaths(['ls-files'], cwd), ...gitPaths(['log', '--diff-merges=first-parent', '--name-only', '--format=', 'HEAD'], cwd)]);
  if (found.length === 0) {
    stdout.write('check:tracked-files: no private paths tracked or in history.\n');
    return 0;
  }
  stderr.write('check:tracked-files: private paths found (tracked now or in history):\n');
  for (const { path, reason } of found) stderr.write(`  ${path} (${reason})\n`);
  return 1;
};

if (require.main === module) process.exitCode = main();

module.exports = { privateReason, findPrivatePaths, main };
