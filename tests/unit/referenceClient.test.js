const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const request = require('supertest');
const { mountReferenceClient } = require('../../middleware/referenceClient');
const notFound = require('../../middleware/notFoundRoute');

describe('reference client serving', () => {
  let dir;
  let server;
  beforeEach(() => {
    // A hidden folder in the install path (for example /home/app/.deploy/ccir) must not matter.
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-client-')), '.hidden-parent', 'dist');
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>CCIR</title>');
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  });
  afterEach(async () => {
    if (server) { server.closeAllConnections(); server.close(); await once(server, 'close'); server = null; }
    fs.rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
  });

  const serve = async (clientDist) => {
    const app = express();
    app.get('/api/v1/known', (req, res) => res.json({ ok: true }));
    mountReferenceClient(app, clientDist);
    app.use(notFound);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };

  it('serves the app shell for client routes, even under a hidden folder', async () => {
    const url = await serve(dir);
    const response = await request(url).get('/dashboard/reports');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>CCIR</title>');
    expect((await request(url).get('/assets/app.js')).status).toBe(200);
  });

  it.each(['/api/v1/nope', '/api/v1/complaints/unknown/deeper', '/api'])('never answers the API path %s with the app shell', async (apiPath) => {
    const url = await serve(dir);
    const response = await request(url).get(apiPath);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' }, msg: 'Route not found' });
    expect((await request(url).get('/api/v1/known')).body).toEqual({ ok: true });
  });

  it('mounts nothing when the client has not been built', async () => {
    const url = await serve(path.join(dir, 'missing'));
    expect((await request(url).get('/dashboard')).status).toBe(404);
  });

  it('answers the JSON 404 when the build has no app shell', async () => {
    fs.rmSync(path.join(dir, 'index.html'));
    const url = await serve(dir);
    const response = await request(url).get('/dashboard');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
