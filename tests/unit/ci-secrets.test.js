const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gitleaksArgs, formatFindings, main } = require('../../scripts/ci/checkSecrets');

const script = path.resolve(__dirname, '../../scripts/ci/checkSecrets.js');

// Every test builds its own repository: CI checks this project out shallow for the test jobs, so
// nothing here may depend on how this checkout was cloned.
const tempDirs = [];
const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});
// Independent of this machine's git settings: a global signing key or hooks path must not make a
// commit fail silently.
const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result;
};
const repo = (commits = ['a']) => {
  const dir = tempDir('ccir-secrets-');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'scan@example.test');
  git(dir, 'config', 'user.name', 'Scan Test');
  for (const name of commits) {
    fs.writeFileSync(path.join(dir, name), name);
    git(dir, 'add', name);
    git(dir, 'commit', '-qm', name);
  }
  return dir;
};
const capture = () => {
  const out = { text: '' };
  out.write = (t) => { out.text += t; };
  return out;
};
const reportPathOf = (args) => {
  const at = args.indexOf('--report-path');
  // Without the flag a fake gitleaks would write into this checkout.
  if (at === -1) throw new Error('gitleaks was not given --report-path');
  return args[at + 1];
};

describe('secret scan wrapper', () => {
  // CI logs of this public repository are public: a finding must never print the value, and only
  // the reviewed allowlist in .gitleaks.toml may silence one.
  // gitleaks's own log options plus -m: git log shows no diff for a merge commit unless asked, so a
  // value added while resolving a merge would never be scanned (see secretScanSelfTest.js).
  it('scans the whole history, merge commits included, with the reviewed config, redacted, ignoring inline allow comments', () => {
    expect(gitleaksArgs('/tmp/report.json')).toEqual([
      'git', '--config', '.gitleaks.toml', '--redact', '--no-banner', '--ignore-gitleaks-allow',
      '--log-opts=--full-history --all --diff-filter=tuxdb -m',
      '--report-format', 'json', '--report-path', '/tmp/report.json', '.',
    ]);
    // --verbose would print text around each match, which can hold a second value.
    expect(gitleaksArgs('/tmp/report.json')).not.toContain('--verbose');
  });

  it('lists findings by place and rule only, never their content', () => {
    const findings = [
      { File: 'config/a.js', StartLine: 12, RuleID: 'generic-api-key', Commit: '0123456789abcdef0123', Secret: 'REDACTED', Match: 'key = REDACTED', Line: 'key = REDACTED other=hunter2' },
    ];
    expect(formatFindings(findings)).toBe('  config/a.js:12 generic-api-key (commit 0123456789ab)\n');
    expect(formatFindings(findings)).not.toMatch(/hunter2|REDACTED/);
  });

  it('fails with an explanation when gitleaks is not installed, from the command line too', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: repo(),
      env: { ...process.env, GITLEAKS_BIN: '/nonexistent/gitleaks' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gitleaks is not installed');
  });

  describe('in process', () => {
    it('passes gitleaks the arguments and returns its exit code', () => {
      const dir = repo();
      const calls = [];
      const spawn = (binary, args) => { calls.push([binary, args]); return { status: 0 }; };
      expect(main({ cwd: dir, binary: 'gitleaks', spawn, stderr: capture() })).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('gitleaks');
      expect(calls[0][1]).toEqual(gitleaksArgs(reportPathOf(calls[0][1])));
    });

    it('lists what gitleaks found, without content, and fails', () => {
      const dir = repo();
      const stderr = capture();
      const spawn = (binary, args) => {
        fs.writeFileSync(reportPathOf(args), JSON.stringify([
          { File: 'b.js', StartLine: 3, RuleID: 'jwt', Commit: 'fedcba9876543210', Secret: 'REDACTED', Line: 'x' },
        ]));
        return { status: 1 };
      };
      expect(main({ cwd: dir, spawn, stderr })).toBe(1);
      expect(stderr.text).toContain('b.js:3 jwt (commit fedcba987654)');
    });

    it('returns a gitleaks failure that wrote no report as it is', () => {
      expect(main({ cwd: repo(), spawn: () => ({ status: 2 }), stderr: capture() })).toBe(2);
      expect(main({ cwd: repo(), spawn: () => ({ status: null }), stderr: capture() })).toBe(1);
    });

    it('explains a missing gitleaks', () => {
      const stderr = capture();
      expect(main({ cwd: repo(), binary: '/nonexistent/gitleaks', stderr })).toBe(1);
      expect(stderr.text).toContain('gitleaks is not installed');
    });

    // gitleaks reads .gitleaksignore by default, which would silence findings outside the reviewed
    // allowlist.
    it('refuses a .gitleaksignore file', () => {
      const dir = repo();
      fs.writeFileSync(path.join(dir, '.gitleaksignore'), 'abc:file:rule:1\n');
      const stderr = capture();
      let ran = false;
      expect(main({ cwd: dir, spawn: () => { ran = true; return { status: 0 }; }, stderr })).toBe(1);
      expect(ran).toBe(false);
      expect(stderr.text).toContain('.gitleaksignore');
    });

    it('refuses a shallow clone, which would hide history', () => {
      const source = repo(['a', 'b']);
      const shallow = tempDir('ccir-secrets-shallow-');
      git(source, 'clone', '-q', '--depth', '1', `file://${source}`, shallow);
      const stderr = capture();
      expect(main({ cwd: shallow, spawn: () => ({ status: 0 }), stderr })).toBe(1);
      expect(stderr.text).toContain('full history');
    });
  });
});
