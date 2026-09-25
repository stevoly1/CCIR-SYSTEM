const fs = require('node:fs');
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

  // The whole point: without -m, git log never shows the file, so a scan reading plain history
  // cannot see it.
  it('builds a repository where only a merge commit ever adds the credential', () => {
    const dir = buildRepository({ token: fakeToken(), config: '[extend]\nuseDefault = true\n' });
    try {
      expect(gitLog(dir, '--diff-filter=A', 'HEAD')).not.toContain('leak.txt');
      expect(gitLog(dir, '-m', '--diff-filter=A', 'HEAD')).toContain('leak.txt');
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
});
