// Vitest and Playwright both exit 0 when tests are skipped. CI passes a run only when every test
// ran and passed: no failures, skips, todos or flaky retries, and at least one test.
const fs = require('node:fs');

const summarize = (report) => {
  if (report && typeof report.numTotalTests === 'number') {
    return {
      kind: 'vitest',
      total: report.numTotalTests,
      failed: report.numFailedTests ?? 0,
      skipped: report.numPendingTests ?? 0,
      todo: report.numTodoTests ?? 0,
      flaky: 0,
      ok: report.success === true,
    };
  }
  if (report?.stats && typeof report.stats.expected === 'number') {
    const { expected, unexpected = 0, flaky = 0, skipped = 0 } = report.stats;
    return { kind: 'playwright', total: expected + unexpected + flaky + skipped, failed: unexpected, skipped, todo: 0, flaky, ok: true };
  }
  return null;
};

const problems = (summary) => {
  const found = [];
  if (summary.total === 0) found.push('no tests ran');
  if (summary.failed > 0) found.push(`${summary.failed} failed`);
  if (summary.skipped > 0) found.push(`${summary.skipped} skipped`);
  if (summary.todo > 0) found.push(`${summary.todo} todo`);
  if (summary.flaky > 0) found.push(`${summary.flaky} flaky`);
  if (!summary.ok && summary.failed === 0) found.push('the run reported errors');
  return found;
};

const checkFile = (file) => {
  if (!fs.existsSync(file)) return ['results file missing'];
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return ['not a Vitest or Playwright results file'];
  }
  const summary = summarize(report);
  return summary ? problems(summary) : ['not a Vitest or Playwright results file'];
};

const main = (files) => {
  if (files.length === 0) {
    process.stderr.write('usage: check:test-results -- <results.json> [...]\n');
    return 1;
  }
  let failed = false;
  for (const file of files) {
    const found = checkFile(file);
    if (found.length === 0) {
      process.stdout.write(`${file}: every test ran and passed\n`);
    } else {
      failed = true;
      process.stderr.write(`${file}: ${found.join(', ')}\n`);
    }
  }
  return failed ? 1 : 0;
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { summarize, problems };
