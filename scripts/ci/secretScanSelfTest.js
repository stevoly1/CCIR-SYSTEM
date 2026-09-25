// Proves the secret scan sees a credential that only a merge commit added: git log shows no diff
// for merge commits unless asked, so such a value would otherwise never be scanned. Builds a
// throwaway repository whose only credential is a freshly generated fake GitHub token, added while
// resolving a merge and removed by a later commit, then requires check:secrets to fail on it. The
// repository also sets log.diffMerges=cc, which turns merge diffs into combined diffs gitleaks
// cannot read, so the scan must choose its own format. The token is random, lives only in a
// temporary folder that is always removed, and is never printed. CI runs this after the real scan;
// locally it needs gitleaks, like check:secrets.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const checkSecrets = require('./checkSecrets');

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const fakeToken = () => `ghp_${Array.from(crypto.randomBytes(36), (byte) => ALPHANUMERIC[byte % ALPHANUMERIC.length]).join('')}`;

// maintenance.auto=false: commit and merge otherwise start a detached `git maintenance run --auto`,
// which writes into .git/objects after they return and races the removal of the repository.
const git = (cwd, ...args) => {
  const result = spawnSync('git', [
    '-c', 'user.email=self-test@example.test', '-c', 'user.name=Secret Scan Self-Test',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', ...args,
  ], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
};

// Builds, in dir, a repository where leak.txt, holding the token, exists only through a merge
// commit.
const buildRepository = (dir, { token, config }) => {
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const commit = (name, text, message) => { write(name, text); git(dir, 'add', name); git(dir, 'commit', '-qm', message); };
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'log.diffMerges', 'cc');
  commit('.gitleaks.toml', config, 'scan configuration');
  git(dir, 'checkout', '-qb', 'side');
  commit('side.txt', 'side\n', 'side');
  git(dir, 'checkout', '-q', 'main');
  commit('main.txt', 'main\n', 'main');
  git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side');
  commit('leak.txt', `token = "${token}"\n`, 'merge side');
  git(dir, 'rm', '-q', 'leak.txt');
  git(dir, 'commit', '-qm', 'remove leak.txt');
};

const capture = () => {
  const out = { text: '' };
  out.write = (t) => { out.text += t; };
  return out;
};

// Returns the exit code. Options exist so the tests can run it in-process.
const main = ({
  config = fs.readFileSync(path.resolve(__dirname, '../../.gitleaks.toml'), 'utf8'),
  build = buildRepository,
  scan = (cwd, stderr) => checkSecrets.main({ cwd, stderr }),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-scan-self-test-'));
  try {
    build(dir, { token: fakeToken(), config });
    const scanErrors = capture();
    const status = scan(dir, scanErrors);
    if (status === 1 && scanErrors.text.includes('leak.txt:1')) {
      stdout.write('check:secrets-self-test: the scan caught a credential added only by a merge commit.\n');
      return 0;
    }
    stderr.write(`check:secrets-self-test: the scan missed a credential added only by a merge commit (exit ${status}).\n`);
    stderr.write(scanErrors.text);
    return 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

if (require.main === module) process.exitCode = main();

module.exports = { fakeToken, buildRepository, main };
