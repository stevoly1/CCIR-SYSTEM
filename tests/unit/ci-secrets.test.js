const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { GITLEAKS_ARGS, main } = require('../../scripts/ci/checkSecrets');

const script = path.resolve(__dirname, '../../scripts/ci/checkSecrets.js');

describe('secret scan wrapper', () => {
  // CI logs of this public repository are public: a finding must never print the value.
  it('scans the whole git history with the reviewed config and redacts findings', () => {
    expect(GITLEAKS_ARGS).toEqual(['git', '--config', '.gitleaks.toml', '--redact', '--no-banner', '--verbose', '.']);
  });

  it('fails with an explanation when gitleaks is not installed', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, GITLEAKS_BIN: '/nonexistent/gitleaks' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gitleaks is not installed');
  });

  describe('in process', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const capture = () => { const out = { text: '' }; out.write = (t) => { out.text += t; }; return out; };

    it('passes gitleaks the arguments and returns its exit code', () => {
      const calls = [];
      const spawn = (binary, args) => { calls.push([binary, args]); return { status: 1 }; };
      expect(main({ cwd: repoRoot, binary: 'gitleaks', spawn, stderr: capture() })).toBe(1);
      expect(calls).toEqual([['gitleaks', GITLEAKS_ARGS]]);
      expect(main({ cwd: repoRoot, binary: 'gitleaks', spawn: () => ({ status: 0 }), stderr: capture() })).toBe(0);
    });

    it('explains a missing gitleaks', () => {
      const stderr = capture();
      expect(main({ cwd: repoRoot, binary: '/nonexistent/gitleaks', stderr })).toBe(1);
      expect(stderr.text).toContain('gitleaks is not installed');
    });

    it('refuses a shallow clone, which would hide history', () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-secrets-src-'));
      const git = (cwd, ...args) => spawnSync('git', args, { cwd });
      git(source, 'init', '-q');
      git(source, 'config', 'user.email', 'scan@example.test');
      git(source, 'config', 'user.name', 'Scan Test');
      for (const name of ['a', 'b']) { fs.writeFileSync(path.join(source, name), name); git(source, 'add', name); git(source, 'commit', '-qm', name); }
      const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-secrets-shallow-'));
      spawnSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, shallow]);
      const stderr = capture();
      expect(main({ cwd: shallow, spawn: () => ({ status: 0 }), stderr })).toBe(1);
      expect(stderr.text).toContain('full history');
    });
  });
});
