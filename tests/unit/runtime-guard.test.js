const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('runtime guard', () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const guardPath = path.join(projectRoot, 'scripts', 'checkRuntime.js');
  const runGuard = (node, npm) => spawnSync(
    process.execPath,
    [guardPath, '--node', node, '--npm', npm],
    { encoding: 'utf8' },
  );

  it('rejects the unsupported baseline runtime', () => {
    const result = runGuard('23.11.0', '10.9.2');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unsupported Node.js 23.11.0');
    expect(result.stderr).toContain('Unsupported npm 10.9.2');
  });

  it('rejects the superseded Node.js 24 runtime contract', () => {
    const result = runGuard('24.19.0', '11.6.2');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unsupported Node.js 24.19.0; required >=26.9.0 <27.');
    expect(result.stderr).toContain('Unsupported npm 11.6.2; required >=11.19.1 <12.');
  });

  it('rejects the next Node.js major line', () => {
    const result = runGuard('27.0.0', '11.19.1');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unsupported Node.js 27.0.0');
  });

  it.each([
    ['26.9.0', '11.19.1'],
    ['26.10.0', '11.19.1'],
  ])('accepts Node.js %s with npm %s', (node, npm) => {
    const result = runGuard(node, npm);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Node.js ${node} and npm ${npm} satisfy the CCIR runtime contract`);
    expect(result.stderr).toBe('');
  });
});
