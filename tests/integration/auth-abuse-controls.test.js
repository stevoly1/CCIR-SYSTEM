const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const app = require('../../app');
const { AuthThrottle } = require('../../models');
const { createThrottleService } = require('../../services/authThrottleService');
const { createUserFixture } = require('../fixtures/user');
const { unsafeRequest } = require('../helpers/auth');

const login = (email, password = 'wrong-password', forwardedFor) => {
  let test = unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login');
  if (forwardedFor) test = test.set('X-Forwarded-For', forwardedFor);
  return test.send({ email, password });
};

const refresh = (rawCookie, forwardedFor) => {
  let test = request(testServer()).get('/api/v1/users/profile').set('Cookie', `refreshToken=${rawCookie}`);
  if (forwardedFor) test = test.set('X-Forwarded-For', forwardedFor);
  return test;
};

describe('distributed authentication abuse controls', () => {
  it('allows 20 login attempts per IP and rejects the next despite spoofed forwarding headers', async () => {
    const responses = await Promise.all(Array.from({ length: 21 }, (_, attempt) => login(
      `missing-${attempt}@example.test`,
      'wrong-password',
      `203.0.113.${attempt + 1}`,
    )));

    expect(responses.filter((response) => response.status === 401)).toHaveLength(20);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(app.get('trust proxy')).toBe(false);
  });

  it('allows five account failures, denies the next, and treats nonexistent accounts identically', async () => {
    const user = await createUserFixture();
    const failures = [];
    for (let attempt = 0; attempt < 5; attempt += 1) failures.push(await login(user.email));
    const denied = await login(user.email);
    const missing = await login('another-missing@example.test');

    expect(failures.every((response) => response.status === 401)).toBe(true);
    expect(denied.status).toBe(429);
    expect(failures[0].body).toEqual(missing.body);
  });

  it('tells a locked-out caller how long to wait, the same way for real and nonexistent accounts', async () => {
    const user = await createUserFixture();
    for (let attempt = 0; attempt < 5; attempt += 1) await login(user.email);
    for (let attempt = 0; attempt < 5; attempt += 1) await login('never-registered@example.test');
    const denied = await login(user.email);
    const deniedMissing = await login('never-registered@example.test');

    for (const response of [denied, deniedMissing]) {
      expect(response.status).toBe(429);
      expect(response.body.error).toEqual({ code: 'RATE_LIMITED', message: 'Too many attempts. Please try again in 15 minutes.' });
      const retryAfter = Number(response.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(14 * 60);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('clears the account-failure bucket after success without clearing the IP bucket', async () => {
    const user = await createUserFixture();
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, 'fixture-password')).status).toBe(200);
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email)).status).toBe(429);

    const documents = await AuthThrottle.find({ _id: /^login-ip:/ });
    expect(documents).toHaveLength(1);
    expect(documents[0].count).toBe(11);
  });

  it('allows ten failed refreshes per fingerprint and rejects the next uniformly', async () => {
    const responses = [];
    for (let attempt = 0; attempt < 10; attempt += 1) responses.push(await refresh('malformed-same-token'));
    const denied = await refresh('malformed-same-token');

    expect(responses.every((response) => response.status === 401)).toBe(true);
    expect(responses.every((response) => JSON.stringify(response.body) === JSON.stringify(responses[0].body))).toBe(true);
    expect(denied.status).toBe(429);
  });

  it('allows 60 refresh attempts per IP and rejects the next across distinct token fingerprints', async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect((await refresh(`malformed-${attempt}`)).status).toBe(401);
    }
    expect((await refresh('malformed-final')).status).toBe(429);
  });

  it('clears a valid refresh fingerprint after success without clearing its IP counter', async () => {
    const user = await createUserFixture();
    const loginResponse = await login(user.email, 'fixture-password');
    const refreshHeader = loginResponse.headers['set-cookie']
      .find((header) => header.startsWith('refreshToken='))
      .split(';', 1)[0];
    const encodedValue = refreshHeader.slice('refreshToken='.length);
    const fingerprintSubject = decodeURIComponent(encodedValue);
    const throttle = createThrottleService({
      model: AuthThrottle,
      hmacSecret: process.env.AUTH_THROTTLE_HMAC_SECRET,
    });
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await throttle.consume('refresh-token', fingerprintSubject, { limit: 10, windowMs: 15 * 60 * 1000 });
    }

    const response = await request(testServer())
      .get('/api/v1/users/profile')
      .set('Cookie', refreshHeader);

    expect(response.status).toBe(200);
    await expect(throttle.peek('refresh-token', fingerprintSubject)).resolves.toMatchObject({ count: 0 });
    const ipCounters = await AuthThrottle.find({ _id: /^refresh-ip:/ });
    expect(ipCounters).toHaveLength(1);
    expect(ipCounters[0].count).toBe(1);
  });

  it('stores only scoped digests, never raw email or token material', async () => {
    await login('private-person@example.test');
    await refresh('private-refresh-token');
    const serialized = JSON.stringify(await AuthThrottle.find({}).lean());

    expect(serialized).not.toContain('private-person@example.test');
    expect(serialized).not.toContain('private-refresh-token');
    expect(serialized).toMatch(/login-account:[a-f0-9]{64}/);
    expect(serialized).toMatch(/refresh-token:[a-f0-9]{64}/);
  });
});
