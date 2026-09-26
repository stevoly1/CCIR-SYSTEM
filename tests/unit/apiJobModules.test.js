const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

// The API and the worker are separate processes in production. Run in a fresh process, so the
// test suite's own loading of the workers cannot hide what the API process alone has.
const inFreshProcess = (script) => spawnSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });

describe('what the API process loads for background jobs', () => {
  it('has every job type\'s handler for the Jobs page, without loading the queue library', () => {
    const result = inFreshProcess(`
      require('./services/jobs/adminJobsService');
      const registry = require('./services/jobs/registry');
      const types = Object.keys(require('./services/jobs/jobTypes'));
      for (const type of types) registry.handlerFor(type);
      const loaded = Object.keys(require.cache).filter((file) => /node_modules[\\\\/](bullmq|ioredis)[\\\\/]/.test(file));
      process.stdout.write(JSON.stringify({ types: types.length, loaded: loaded.length }));
    `);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ types: 7, loaded: 0 });
  });
});
