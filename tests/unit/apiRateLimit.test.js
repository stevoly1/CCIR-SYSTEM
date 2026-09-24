const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const request = require('supertest');
const { rateLimit } = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { sign } = require('cookie-signature');
const jwt = require('jsonwebtoken');
const { apiRateLimitOptions, createApiRateLimit, API_RATE_LIMITS } = require('../../middleware/apiRateLimit');
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
  const serveWithLimit = async (limit, paths = ['/api/v1/categories']) => {
    const app = express();
    app.use(rateLimit({ ...apiRateLimitOptions, limit }));
    for (const path of paths) app.get(path, (req, res) => res.json({ ok: true }));
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

  it('lets a browser on the approved origin read the 429 when CORS runs first, as in app.js', async () => {
    const cors = require('cors');
    const { getBrowserSecurityConfig } = require('../../config/browserSecurity');
    const { corsOptions } = getBrowserSecurityConfig({ ...process.env, BROWSER_ORIGIN: 'http://localhost:3000', TRUST_PROXY_HOPS: '0' });
    const app = express();
    app.use(cors(corsOptions));
    app.use(rateLimit({ ...apiRateLimitOptions, limit: 1 }));
    app.get('/api/v1/categories', (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    await request(url).get('/api/v1/categories').set('Origin', 'http://localhost:3000').expect(200);
    const response = await request(url).get('/api/v1/categories').set('Origin', 'http://localhost:3000');
    expect(response.status).toBe(429);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });

  it('never limits health probes, but still limits everything else', async () => {
    const url = await serveWithLimit(2, ['/api/v1/health', '/api/v1/health/ready', '/api/v1/healthy', '/api/v1/categories']);
    for (let i = 0; i < 150; i += 1) {
      const path = i % 2 ? '/api/v1/health/ready' : '/api/v1/health';
      const response = await request(url).get(path);
      expect(response.status).toBe(200);
    }
    await request(url).get('/api/v1/categories').expect(200);
    await request(url).get('/api/v1/healthy').expect(200);
    await request(url).get('/api/v1/categories').expect(429);
  });

  it('keeps the production window and limits', () => {
    expect(apiRateLimitOptions.windowMs).toBe(15 * 60 * 1000);
    expect(typeof apiRateLimitOptions.handler).toBe('function');
    expect(API_RATE_LIMITS).toEqual({ perCaller: 300, perAddress: 3000 });
  });

  describe('per account and per address', () => {
    const COOKIE_SECRET = 'rate-limit-cookie-secret';
    const sessionCookie = (userId, secret = process.env.JWT_TOKEN) => {
      const token = jwt.sign({ userId }, secret, { expiresIn: '15m' });
      return `accessToken=${encodeURIComponent(`s:${sign(token, COOKIE_SECRET)}`)}`;
    };

    // Cookies are parsed before the limiter, as in app.js, so it can tell who is signed in.
    const serveWithLimits = async (limits) => {
      vi.stubEnv('JWT_TOKEN', 'rate-limit-access-secret');
      const app = express();
      app.use(cookieParser(COOKIE_SECRET));
      app.use(createApiRateLimit(limits));
      app.get('/api/v1/complaints', (req, res) => res.json({ ok: true }));
      app.use(errorHandler);
      server = http.createServer(app);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return `http://127.0.0.1:${server.address().port}`;
    };
    const get = (url, cookie) => {
      const call = request(url).get('/api/v1/complaints');
      return cookie ? call.set('Cookie', cookie) : call;
    };

    it('gives each signed-in account its own budget, so people sharing an address do not share one', async () => {
      const url = await serveWithLimits({ perCaller: 2, perAddress: 100 });
      const ada = sessionCookie('a'.repeat(24));
      const bola = sessionCookie('b'.repeat(24));
      await get(url, ada).expect(200);
      await get(url, ada).expect(200);
      await get(url, ada).expect(429);
      await get(url, bola).expect(200);
      await get(url, bola).expect(200);
      await get(url, bola).expect(429);
    });

    it('counts requests without a valid session against their address', async () => {
      const url = await serveWithLimits({ perCaller: 2, perAddress: 100 });
      await get(url).expect(200);
      await get(url).expect(200);
      await get(url).expect(429);
      // A token signed with the wrong key is no session: it shares the address budget.
      await get(url, sessionCookie('c'.repeat(24), 'not-the-access-secret')).expect(429);
      // A valid session still has its own budget.
      await get(url, sessionCookie('d'.repeat(24))).expect(200);
    });

    it('caps everything from one address, whoever is signed in', async () => {
      const url = await serveWithLimits({ perCaller: 100, perAddress: 3 });
      await get(url, sessionCookie('a'.repeat(24))).expect(200);
      await get(url, sessionCookie('b'.repeat(24))).expect(200);
      await get(url).expect(200);
      const response = await get(url, sessionCookie('e'.repeat(24)));
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMITED');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('never limits health probes', async () => {
      vi.stubEnv('JWT_TOKEN', 'rate-limit-access-secret');
      const app = express();
      app.use(cookieParser(COOKIE_SECRET));
      app.use(createApiRateLimit({ perCaller: 1, perAddress: 1 }));
      app.get('/api/v1/health/ready', (req, res) => res.json({ ok: true }));
      server = http.createServer(app);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const url = `http://127.0.0.1:${server.address().port}`;
      for (let i = 0; i < 5; i += 1) await request(url).get('/api/v1/health/ready').expect(200);
    });
  });
});
