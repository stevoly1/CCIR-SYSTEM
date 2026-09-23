const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const request = require('supertest');
const { rateLimit } = require('express-rate-limit');
const { apiRateLimitOptions } = require('../../middleware/apiRateLimit');
const errorHandler = require('../../middleware/errorHandler');

describe('API rate limit', () => {
  let server;
  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
    server = null;
  });

  // Bound to loopback explicitly, as tests/helpers/testServer.js explains.
  const serveWithLimit = async (limit) => {
    const app = express();
    app.use(rateLimit({ ...apiRateLimitOptions, limit }));
    app.get('/api/v1/categories', (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };

  it('answers over-limit requests with the JSON error envelope', async () => {
    const url = await serveWithLimit(1);
    await request(url).get('/api/v1/categories').expect(200);
    const response = await request(url).get('/api/v1/categories');
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
      msg: 'Too many requests, please try again later',
    });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps the production window and limit', () => {
    expect(apiRateLimitOptions.windowMs).toBe(15 * 60 * 1000);
    expect(typeof apiRateLimitOptions.handler).toBe('function');
  });
});
