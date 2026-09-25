// Scans the whole git history for credentials with gitleaks, using .gitleaks.toml (the default
// rules plus reviewed test-only allowlist entries). CI logs of this public repository are public, so
// nothing a finding contains is printed: gitleaks writes a redacted JSON report to a temporary
// folder and this script lists only where each finding is and which rule matched. Only the reviewed
// allowlist may silence a finding: inline gitleaks:allow comments are ignored and a .gitleaksignore
// file is refused. CI installs gitleaks (see .github/workflows/ci.yml); locally it is optional.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

// No --verbose: it prints text around each match, which can hold another value. --log-opts repeats
// gitleaks's own git log options (v8.30.1 sources/git.go) and adds -m: git log shows no diff for a
// merge commit unless asked, so a value added while resolving a merge would never be scanned
// (secretScanSelfTest.js proves it is).
const gitleaksArgs = (reportPath) => [
  'git', '--config', '.gitleaks.toml', '--redact', '--no-banner', '--ignore-gitleaks-allow',
  '--log-opts=--full-history --all --diff-filter=tuxdb -m',
  '--report-format', 'json', '--report-path', reportPath, '.',
];

const formatFindings = (findings) => findings
  .map((f) => `  ${f.File}:${f.StartLine} ${f.RuleID} (commit ${String(f.Commit).slice(0, 12)})\n`)
  .join('');

const readFindings = (reportPath) => {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
};

// Returns the exit code. Options exist so the tests can run it in-process.
const main = ({
  cwd = process.cwd(),
  binary = process.env.GITLEAKS_BIN || 'gitleaks',
  spawn = spawnSync,
  stderr = process.stderr,
} = {}) => {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd, encoding: 'utf8' }).trim() === 'true') {
    stderr.write('check:secrets needs the full history; this clone is shallow (use fetch-depth: 0).\n');
    return 1;
  }
  if (fs.existsSync(path.join(cwd, '.gitleaksignore'))) {
    stderr.write('check:secrets: remove .gitleaksignore; add reviewed test-only entries to the allowlist in .gitleaks.toml instead.\n');
    return 1;
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-gitleaks-'));
  const reportPath = path.join(reportDir, 'report.json');
  try {
    const result = spawn(binary, gitleaksArgs(reportPath), { cwd, stdio: 'inherit' });
    if (result.error?.code === 'ENOENT') {
      stderr.write('check:secrets: gitleaks is not installed. CI installs it; locally see the README (Continuous integration).\n');
      return 1;
    }
    const findings = readFindings(reportPath);
    if (result.status !== 0 && Array.isArray(findings) && findings.length > 0) {
      stderr.write(`check:secrets: ${findings.length} possible secret(s), values withheld. Review each one (see .gitleaks.toml):\n`);
      stderr.write(formatFindings(findings));
    }
    return result.status ?? 1;
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
};

if (require.main === module) process.exitCode = main();

module.exports = { gitleaksArgs, formatFindings, main };
