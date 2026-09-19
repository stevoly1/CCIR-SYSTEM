const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('runtime guard', () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const guardPath = path.join(projectRoot, 'scripts', 'checkRuntime.js');

  it('rejects the unsupported baseline runtime', () => {
    const result = spawnSync(
      process.execPath,
      [guardPath, '--node', '23.11.0', '--npm', '10.9.2'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unsupported Node.js 23.11.0');
    expect(result.stderr).toContain('Unsupported npm 10.9.2');
  });

  it('accepts the pinned runtime contract', () => {
    const result = spawnSync(
      process.execPath,
      [guardPath, '--node', '24.19.0', '--npm', '11.6.2'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Node.js 24.19.0 and npm 11.6.2 satisfy the CCIR runtime contract');
    expect(result.stderr).toBe('');
  });
});
