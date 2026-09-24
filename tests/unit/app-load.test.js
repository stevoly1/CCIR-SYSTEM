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
        // Generous wall-clock budget: a listening or connecting module never exits, so a hang still
        // fails; slow cold loads on a contended machine must not.
        timeout: 10000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('function');
    expect(result.stderr).toBe('');
  }, 15000);

  // The development worktree lives inside another checkout, so Node's upward module lookup could
  // silently load a package this project does not install (as happened with a removed `morgan`).
  // The child refuses any resolution outside the project, as a standalone install would: optional
  // requires (for example `debug` trying `supports-color`) are skipped, a missing package fails.
  it('loads with every dependency installed inside this project', () => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const standalone = [
      "const Module = require('node:module');",
      "const path = require('node:path');",
      'const root = process.cwd() + path.sep;',
      'const resolve = Module._resolveFilename;',
      'Module._resolveFilename = function standaloneResolve(request, ...rest) {',
      '  const file = resolve.call(this, request, ...rest);',
      '  if (path.isAbsolute(file) && !file.startsWith(root)) {',
      "    throw Object.assign(new Error(`Cannot find module '${request}' inside the project`), { code: 'MODULE_NOT_FOUND' });",
      '  }',
      '  return file;',
      '};',
      "require('./app');",
      "process.stdout.write('loaded');",
    ].join('\n');
    const result = spawnSync(process.execPath, ['-e', standalone], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BROWSER_ORIGIN: 'http://localhost:3000',
        TRUST_PROXY_HOPS: '0',
        AUTH_THROTTLE_HMAC_SECRET: 'app-load-auth-throttle-secret',
        NODE_ENV: 'test',
        MONGO_URL: '',
      },
      encoding: 'utf8',
      timeout: 10000,
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('loaded');
  }, 15000);

  // express-openapi-validator is a development dependency: a production install omits it.
  it('never loads the contract validator unless contract checking is switched on', () => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const result = spawnSync(
      process.execPath,
      ['-e', "require('./app'); process.stdout.write(String(Object.keys(require.cache).some((file) => file.includes('express-openapi-validator'))))"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          OPENAPI_VALIDATE: '',
          BROWSER_ORIGIN: 'http://localhost:3000',
          TRUST_PROXY_HOPS: '0',
          AUTH_THROTTLE_HMAC_SECRET: 'app-load-auth-throttle-secret',
          NODE_ENV: 'test',
          MONGO_URL: '',
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('false');
  }, 15000);

  it('never loads the contract validator in production, even with contract checking switched on', () => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const result = spawnSync(
      process.execPath,
      ['-e', "require('./app'); process.stdout.write(String(Object.keys(require.cache).some((file) => file.includes('express-openapi-validator'))))"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          OPENAPI_VALIDATE: 'true',
          BROWSER_ORIGIN: 'https://ccir.example.test',
          TRUST_PROXY_HOPS: '0',
          AUTH_THROTTLE_HMAC_SECRET: 'app-load-auth-throttle-secret',
          NODE_ENV: 'production',
          MONGO_URL: '',
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('false');
  }, 15000);
});
