const http = require('node:http');
const { once } = require('node:events');
const app = require('../../app');

// Supertest's own `app.listen(0)` binds every interface but then connects to 127.0.0.1.
// On macOS that wildcard bind succeeds even when another local process already holds the
// same port on 127.0.0.1, and requests then reach that other process (intermittent 404s).
// One server per test file, bound explicitly to 127.0.0.1, lets the OS choose only a
// loopback port that nobody else holds.
let server;

beforeAll(async () => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const testServer = () => {
  if (!server) throw new Error('The shared test server has not started yet');
  return server;
};

module.exports = { testServer };
