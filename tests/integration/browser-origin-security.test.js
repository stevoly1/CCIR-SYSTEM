const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');

const cookieAttributes = (header) => header.split(';').slice(1).map((part) => part.trim().toLowerCase());

describe('browser origin security', () => {
  it('rejects unsafe requests with a missing or disallowed origin', async () => {
    const missing = await request(testServer()).post('/api/v1/auth/login').send({
      email: 'nobody@example.com',
      password: 'irrelevant-password',
    });
    const disallowed = await request(testServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:51730')
      .set('X-Forwarded-Host', 'localhost:3000')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: 'nobody@example.com', password: 'irrelevant-password' });

    expect(missing.status).toBe(403);
    expect(disallowed.status).toBe(403);
  });

  it('emits credentialed CORS headers only for the exact configured origin', async () => {
    const allowed = await request(testServer())
      .get('/api/v1/health')
      .set('Origin', process.env.BROWSER_ORIGIN);
    const disallowed = await request(testServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:51730');

    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(process.env.BROWSER_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(disallowed.status).toBe(200);
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows exact-origin preflight without treating OPTIONS as a state change', async () => {
    const response = await request(testServer())
      .options('/api/v1/complaints')
      .set('Origin', process.env.BROWSER_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(process.env.BROWSER_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows safe reads and the state-protected Google callback without Origin', async () => {
    const health = await request(testServer()).get('/api/v1/health');
    const callback = await request(testServer()).get('/api/v1/auth/google/callback');

    expect(health.status).toBe(200);
    expect(callback.status).toBe(302);
  });

  it('issues signed HttpOnly Lax cookies and clears them with matching attributes', async () => {
    const password = 'origin-test-password';
    const user = await createUserFixture({ password });
    const agent = request.agent(testServer());
    const login = await unsafeRequest(agent, 'post', '/api/v1/auth/login')
      .send({ email: user.email, password });

    expect(login.status).toBe(200);
    const issued = login.headers['set-cookie'];
    expect(issued).toHaveLength(2);
    for (const header of issued) {
      expect(header).toMatch(/=(?:s%3A|s:)/);
      expect(cookieAttributes(header)).toEqual(expect.arrayContaining([
        'path=/',
        'httponly',
        'samesite=lax',
      ]));
    }

    const logout = await unsafeRequest(agent, 'post', '/api/v1/users/logout');
    expect(logout.status).toBe(200);
    const cleared = logout.headers['set-cookie'];
    expect(cleared).toHaveLength(2);
    for (const header of cleared) {
      expect(cookieAttributes(header)).toEqual(expect.arrayContaining([
        'path=/',
        'httponly',
        'samesite=lax',
      ]));
    }
  });

  it('accepts an exact-origin authenticated mutation through the shared helper', async () => {
    const { agent } = await createAuthenticatedAgent();
    const response = await unsafeRequest(agent, 'patch', '/api/v1/users/profile')
      .send({ name: 'Updated Citizen' });

    expect(response.status).toBe(200);
  });
});
