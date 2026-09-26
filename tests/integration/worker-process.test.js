const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { WorkerHeartbeat } = require('../../models');
const { startRedis } = require('../setup/memoryRedis.cjs');

const ROOT = path.join(__dirname, '..', '..');
// The same database the test reads, and a working directory with no .env, so a developer's real
// provider keys can never reach a child process.
const childEnv = (redisUrl, extra = {}) => {
  const url = new URL(process.env.TEST_MONGO_URI);
  url.pathname = '/ccir-integration';
  return { ...process.env, MONGO_URL: url.toString(), REDIS_URL: redisUrl, RESEND_API_KEY: '', LOG_LEVEL: 'info', ...extra };
};
const tempDirs = [];
const emptyDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-worker-'));
  tempDirs.push(dir);
  return dir;
};

let redis;
beforeAll(async () => { redis = await startRedis(); });
afterAll(async () => {
  await redis.stop();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const collect = (child) => {
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return () => output;
};

const runUntilHeartbeat = async (script, env) => {
  const child = spawn(process.execPath, [path.join(ROOT, script)], { cwd: emptyDir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = collect(child);
  try {
    await vi.waitFor(async () => expect(await WorkerHeartbeat.countDocuments({ pid: child.pid })).toBe(1), { timeout: 20000, interval: 200 });
  } catch {
    child.kill('SIGKILL');
    throw new Error(`${script} never beat: ${output().slice(-2000)}`);
  }
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  return { code, output: output() };
};

describe('worker processes', () => {
  it('runs as a separate process and stops cleanly on SIGTERM', async () => {
    const { code, output } = await runUntilHeartbeat('worker.js', childEnv(redis.url));
    expect(code, output).toBe(0);
    expect(output).toContain('Background work stopped');
  }, 40000);

  it('runs inside the API when WORKERS_IN_PROCESS=true, and stops with it', async () => {
    const { code, output } = await runUntilHeartbeat('server.js', childEnv(redis.url, { WORKERS_IN_PROCESS: 'true', PORT: '0' }));
    expect(code, output).toBe(0);
    expect(output).toContain('Background work stopped');
  }, 40000);

  it('refuses to start the worker without REDIS_URL', async () => {
    const child = spawn(process.execPath, [path.join(ROOT, 'worker.js')], { cwd: emptyDir(), env: childEnv(''), stdio: ['ignore', 'pipe', 'pipe'] });
    const output = collect(child);
    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(output()).toContain('REDIS_URL is required to run background work');
  }, 30000);

  it('refuses to start the API with an invalid queue setting', async () => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: emptyDir(), env: childEnv('', { WORKERS_IN_PROCESS: 'yes', PORT: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
    const output = collect(child);
    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(output()).toContain('WORKERS_IN_PROCESS must be true or false');
  }, 30000);
});
