const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('app module boundary', () => {
  it('loads without connecting, listening, or exiting the process', () => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const result = spawnSync(
      process.execPath,
      ['-e', "const app = require('./app'); process.stdout.write(typeof app)"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          BROWSER_ORIGIN: 'http://localhost:3000',
          TRUST_PROXY_HOPS: '0',
          AUTH_THROTTLE_HMAC_SECRET: 'app-load-auth-throttle-secret',
          NODE_ENV: 'test',
          MONGO_URL: '',
          PORT: '0',
        },
        encoding: 'utf8',
        timeout: 2000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('function');
    expect(result.stderr).toBe('');
  });
});
