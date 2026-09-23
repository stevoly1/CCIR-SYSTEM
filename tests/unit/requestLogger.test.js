const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const request = require('supertest');
const { captureLogs } = require('../helpers/captureLogs');
const { requestLogger, REQUEST_ID_PATTERN } = require('../../middleware/requestLogger');

describe('request logger middleware', () => {
  let logs;
  let server;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(async () => {
    logs.restore();
    if (server) {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      server = null;
    }
  });

  // Bound to loopback explicitly, as tests/helpers/testServer.js explains.
  const appWith = async (handler) => {
    const app = express();
    app.use(requestLogger);
    app.get('/probe', handler);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };

  it('scrubs URL secrets from an error attached to a failed request', async () => {
    const app = await appWith((req, res) => {
      res.err = new Error('upstream https://g.test/v1?key=AIzaLEAK123 refused');
      res.status(500).end();
    });
    await request(app).get('/probe');
    const line = logs.lines.find((entry) => entry.req);
    expect(line.level).toBe(50);
    expect(line.err).toMatchObject({ type: 'Error' });
    expect(logs.text()).not.toContain('AIzaLEAK123');
  });

  it('gives each request its own child logger carrying the request id', async () => {
    const app = await appWith((req, res) => { req.log.info('inside the handler'); res.end(); });
    const response = await request(app).get('/probe');
    expect(logs.lines.find((entry) => entry.msg === 'inside the handler').requestId).toBe(response.headers['x-request-id']);
  });

  it.each([['abcdefgh', true], ['A.b_c-1234', true], ['x'.repeat(64), true], ['short', false], ['x'.repeat(65), false], ['spa ce-0001', false]])(
    'accepts %j as a request id: %s',
    (value, accepted) => {
      expect(REQUEST_ID_PATTERN.test(value)).toBe(accepted);
    },
  );
});
