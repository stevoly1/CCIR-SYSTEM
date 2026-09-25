const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fakeToken, buildRepository, main } = require('../../scripts/ci/secretScanSelfTest');

const capture = () => {
  const out = { text: '' };
  out.write = (t) => { out.text += t; };
  return out;
};
const gitLog = (cwd, ...args) => spawnSync('git', ['log', '--name-only', '--format=', ...args], { cwd, encoding: 'utf8' }).stdout;

describe('secret scan self-test', () => {
  it('makes a fresh token in the GitHub personal access token format each time', () => {
    const token = fakeToken();
    expect(token).toMatch(/^ghp_[0-9A-Za-z]{36}$/);
    expect(fakeToken()).not.toBe(token);
  });

  // The whole point: without a merge-diff option, git log never shows the file, so a scan reading
  // plain history cannot see it. The repository also turns merge diffs into combined diffs, which
  // gitleaks cannot read, so the scan must choose its own merge-diff format.
  it('builds a repository where only a merge commit ever adds the credential', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-scan-self-test-'));
    try {
      buildRepository(dir, { token: fakeToken(), config: '[extend]\nuseDefault = true\n' });
      expect(gitLog(dir, '--diff-filter=A', 'HEAD')).not.toContain('leak.txt');
      expect(gitLog(dir, '--diff-merges=first-parent', '--diff-filter=A', 'HEAD')).toContain('leak.txt');
      expect(spawnSync('git', ['config', 'log.diffMerges'], { cwd: dir, encoding: 'utf8' }).stdout.trim()).toBe('cc');
      expect(fs.existsSync(path.join(dir, 'leak.txt'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when the scan fails on the planted credential, without printing it', () => {
    const stdout = capture();
    const stderr = capture();
    let scannedDir;
    const scan = (dir, scanErrors) => {
      scannedDir = dir;
      expect(fs.readFileSync(path.join(dir, '.gitleaks.toml'), 'utf8')).toBe('config');
      scanErrors.write('  leak.txt:1 github-pat (commit 0123456789ab)\n');
      return 1;
    };
    expect(main({ config: 'config', scan, stdout, stderr })).toBe(0);
    expect(stdout.text).toContain('caught a credential added only by a merge commit');
    expect(stdout.text + stderr.text).not.toMatch(/ghp_/);
    // The throwaway repository is removed.
    expect(fs.existsSync(scannedDir)).toBe(false);
  });

  it.each([
    ['the scan passes', () => 0],
    ['the scan fails for another reason', (dir, scanErrors) => { scanErrors.write('gitleaks is not installed\n'); return 1; }],
  ])('fails when %s', (_label, scan) => {
    const stderr = capture();
    expect(main({ config: 'config', scan, stdout: capture(), stderr })).toBe(1);
    expect(stderr.text).toContain('missed a credential added only by a merge commit');
  });

  // The token is on disk from the moment the merge is made: a failure while building must not leave it.
  it('removes the throwaway repository when building it fails', () => {
    let builtIn;
    const build = (dir) => { builtIn = dir; fs.writeFileSync(path.join(dir, 'leak.txt'), 'x'); throw new Error('git failed'); };
    expect(() => main({ config: 'config', build, scan: () => 1, stdout: capture(), stderr: capture() })).toThrow('git failed');
    expect(fs.existsSync(builtIn)).toBe(false);
  });
});
