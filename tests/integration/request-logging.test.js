const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { captureLogs } = require('../helpers/captureLogs');
const { createAuthenticatedAgent } = require('../helpers/auth');

describe('request logging', () => {
  let logs;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  const requestLines = () => logs.lines.filter((line) => line.req && line.res);

  it('generates a request id, returns it, and logs one line with it', async () => {
    const response = await request(testServer()).get('/api/v1/categories');
    const id = response.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ requestId: id, req: { method: 'GET', path: '/api/v1/categories' }, res: { statusCode: 401 } });
  });

  it('reuses a valid incoming request id', async () => {
    const response = await request(testServer()).get('/api/v1/categories').set('X-Request-Id', 'client-trace-0001');
    expect(response.headers['x-request-id']).toBe('client-trace-0001');
    expect(requestLines()[0].requestId).toBe('client-trace-0001');
  });

  it.each(['short', 'x'.repeat(65), 'has spaces here', 'semi;colon-0001'])('replaces an invalid request id %j', async (bad) => {
    const response = await request(testServer()).get('/api/v1/categories').set('X-Request-Id', bad);
    expect(response.headers['x-request-id']).not.toBe(bad);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs the path without its query string, and no cookies, IP or other headers', async () => {
    const { agent } = await createAuthenticatedAgent();
    logs.lines.length = 0;
    await agent.get('/api/v1/location/autocomplete?input=12%20Private%20Street').set('X-Secret-Header', 'nope');
    const line = requestLines()[0];
    expect(line.req.path).toBe('/api/v1/location/autocomplete');
    expect(logs.text()).not.toContain('Private');
    expect(logs.text()).not.toContain('nope');
    expect(line.req).not.toHaveProperty('remoteAddress');
    expect(Object.keys(line.req.headers || {})).toEqual(expect.not.arrayContaining(['cookie', 'authorization']));
  });

  it('never logs the password, tokens or cookies of a sign-in', async () => {
    const { password } = await createAuthenticatedAgent({ password: 'Sign-in-secret-77' });
    expect(requestLines().some((line) => line.req.path === '/api/v1/auth/login')).toBe(true);
    expect(logs.text()).not.toContain(password);
    expect(logs.text()).not.toMatch(/refreshToken|accessToken|set-cookie|eyJ/i);
  });

  it('adds the signed-in user id, and never the email', async () => {
    const { agent, user } = await createAuthenticatedAgent();
    logs.lines.length = 0;
    await agent.get('/api/v1/users/profile');
    expect(requestLines()[0].userId).toBe(String(user._id));
    expect(logs.text()).not.toContain(user.email);
  });

  it('logs health probes at debug level', async () => {
    await request(testServer()).get('/api/v1/health');
    expect(requestLines()[0].level).toBe(20);
  });
});
