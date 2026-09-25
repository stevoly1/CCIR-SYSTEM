// DEC-002 guard: the public repository must never hold private records (docs/, tools/), Word
// files, environment files or database backups. CI checks every tracked path and every path any
// commit in history touched, so something added and later removed is still caught. The local
// pre-push hook applies the same rule to pushes.
const { execFileSync } = require('node:child_process');

const RULES = [
  { reason: 'environment file', test: (p) => /(^|\/)\.env(\.|$)/.test(p) && !/(^|\/)\.env\.example$/.test(p) },
  { reason: 'private records', test: (p) => /^(docs|tools)\//.test(p) },
  { reason: 'Word document', test: (p) => /\.docx$/i.test(p) },
  { reason: 'database backup', test: (p) => /^backups\//.test(p) || /\.archive\.gz$/.test(p) },
];

const privateReason = (path) => RULES.find((rule) => rule.test(path))?.reason ?? null;

const findPrivatePaths = (paths) => [...new Set(paths)]
  .filter((path) => privateReason(path))
  .sort()
  .map((path) => ({ path, reason: privateReason(path) }));

// core.quotePath=false: by default git quotes non-ASCII paths ("docs/\303\251.md"), which the rules
// would not recognise.
const gitLines = (args, cwd) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  .split('\n')
  .filter(Boolean);

// Returns the exit code. Options exist so the tests can run it in-process.
const main = ({ cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) => {
  if (gitLines(['rev-parse', '--is-shallow-repository'], cwd)[0] === 'true') {
    stderr.write('check:tracked-files needs the full history; this clone is shallow (use fetch-depth: 0).\n');
    return 1;
  }
  const found = findPrivatePaths([...gitLines(['ls-files'], cwd), ...gitLines(['log', '--name-only', '--format=', 'HEAD'], cwd)]);
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
