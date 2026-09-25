const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { GITLEAKS_ARGS } = require('../../scripts/ci/checkSecrets');

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
});
