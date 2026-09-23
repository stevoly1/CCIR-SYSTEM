const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const request = require('supertest');
const { captureLogs } = require('../helpers/captureLogs');
const { requestLogger } = require('../../middleware/requestLogger');
const errorHandler = require('../../middleware/errorHandler');

describe('error handler', () => {
  let logs;
  let server;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(async () => {
    logs.restore();
    if (!server) return;
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
    server = null;
  });

  // Bound to loopback explicitly, as tests/helpers/testServer.js explains.
  const serve = async (handler) => {
    const app = express();
    // Express's fallback handler prints to the console only outside the test env.
    app.set('env', 'production');
    app.use(requestLogger);
    app.get('/probe', handler);
    app.use(errorHandler);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };

  it('logs an error raised after the response started, then leaves the connection to Express', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await serve((req, res, next) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial');
      next(new Error('failed mid-stream'));
    });

    await request(url).get('/probe').catch(() => {});

    const line = logs.lines.find((entry) => entry.msg === 'Unhandled error');
    expect(line).toMatchObject({ level: 50, err: { message: 'failed mid-stream' } });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
