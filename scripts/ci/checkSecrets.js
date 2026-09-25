// Scans the whole git history for credentials with gitleaks, using .gitleaks.toml (the default
// rules plus reviewed test-only allowlist entries). --redact keeps any value out of the output:
// CI logs of this public repository are public. CI installs gitleaks (see .github/workflows/ci.yml);
// locally it is optional.
const { spawnSync, execFileSync } = require('node:child_process');

const GITLEAKS_ARGS = ['git', '--config', '.gitleaks.toml', '--redact', '--no-banner', '--verbose', '.'];

const main = () => {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true') {
    process.stderr.write('check:secrets needs the full history; this clone is shallow (use fetch-depth: 0).\n');
    return 1;
  }
  const result = spawnSync(process.env.GITLEAKS_BIN || 'gitleaks', GITLEAKS_ARGS, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    process.stderr.write('check:secrets: gitleaks is not installed. CI installs it; locally see the README (Continuous integration).\n');
    return 1;
  }
  return result.status ?? 1;
};

if (require.main === module) process.exitCode = main();

module.exports = { GITLEAKS_ARGS };
