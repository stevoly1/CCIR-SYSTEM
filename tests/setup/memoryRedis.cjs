// A throwaway redis-server for tests and the journey server: a free local port, nothing written to
// disk, and BullMQ's required eviction policy. A missing program fails loudly; tests never skip.
const { spawn } = require('node:child_process');
const net = require('node:net');

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const NOT_FOUND = 'redis-server was not found. Install Redis (macOS: brew install redis; Ubuntu: sudo apt-get install redis-server) or set REDIS_SERVER_BIN to its path.';

const startOnce = (bin, port) => new Promise((resolve, reject) => {
  const child = spawn(bin, [
    '--port', String(port), '--bind', '127.0.0.1',
    '--save', '', '--appendonly', 'no', '--maxmemory-policy', 'noeviction',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const onData = (chunk) => {
    output += chunk;
    if (output.includes('Ready to accept connections')) {
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      // Keep draining, so a full pipe can never stall the server.
      child.stdout.resume();
      resolve(child);
    }
  };
  const onExit = (code) => reject(Object.assign(new Error(`redis-server exited (${code}): ${output.slice(-500)}`), { output }));
  child.stdout.on('data', onData);
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.once('error', (error) => reject(error.code === 'ENOENT' ? new Error(NOT_FOUND) : error));
  child.once('exit', onExit);
});

const startRedis = async ({ attempts = 3 } = {}) => {
  const bin = process.env.REDIS_SERVER_BIN || 'redis-server';
  for (let attempt = 1; ; attempt += 1) {
    const port = await freePort();
    try {
      const child = await startOnce(bin, port);
      // A test process that ends without stop() (a crash, a timeout) must not leave the server running.
      const killOnExit = () => child.kill('SIGKILL');
      process.once('exit', killOnExit);
      const stop = () => new Promise((resolve) => {
        process.off('exit', killOnExit);
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      });
      return { url: `redis://127.0.0.1:${port}`, port, stop };
    } catch (error) {
      // Another process can take the port between freePort() and the bind; only that is retried.
      if (attempt >= attempts || !/Address already in use/i.test(error.output ?? '')) throw error;
    }
  }
};

module.exports = { startRedis };
