const signature = require('cookie-signature');
const request = require('supertest');
const app = require('../../app');
const { RefreshToken, User } = require('../../models');
const googleOAuthService = require('../../services/googleOAuthService');
const { createUserFixture } = require('../fixtures/user');

const successProfile = (overrides = {}) => ({
  googleId: 'google-subject-123',
  email: 'person@example.test',
  emailVerified: true,
  name: 'Google Person',
  avatarUrl: 'https://images.example/person.png',
  ...overrides,
});

const sessionCookies = (response) => (response.headers['set-cookie'] || [])
  .filter((header) => /^(accessToken|refreshToken)=/.test(header));

const beginGoogle = async (agent) => {
  const response = await agent.get('/api/v1/auth/google');
  const location = new URL(response.headers.location);
  return { response, state: location.searchParams.get('state') };
};

const callback = (agent, state, code = 'authorization-code') => agent
  .get('/api/v1/auth/google/callback')
  .query({ code, state });

const signedStateCookie = (state, issuedAt = Date.now()) => {
  const value = `${issuedAt}.${state}`;
  return `oauthState=${encodeURIComponent(`s:${signature.sign(value, process.env.COOKIE)}`)}`;
};

describe('Google authentication callback', () => {
  const originalGoogleEnv = {};

  beforeAll(() => {
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']) {
      originalGoogleEnv[name] = process.env[name];
    }
    process.env.GOOGLE_CLIENT_ID = 'test-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:8080/api/v1/auth/google/callback';
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(originalGoogleEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('creates a new account only from a verified unused identity', async () => {
    vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockResolvedValue(successProfile());
    const agent = request.agent(app);
    const { state } = await beginGoogle(agent);

    const response = await callback(agent, state);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/dashboard`);
    expect(sessionCookies(response)).toHaveLength(2);
    expect(await User.findOne({ googleId: 'google-subject-123' })).toMatchObject({
      email: 'person@example.test',
      authProvider: 'google',
      isActive: true,
    });
  });

  it('resolves an existing subject and adopts an unowned changed verified email', async () => {
    const existing = await createUserFixture({
      authProvider: 'google',
      googleId: 'google-subject-123',
      email: 'old@example.test',
      password: undefined,
    });
    vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockResolvedValue(successProfile({
      email: 'new@example.test',
    }));
    const agent = request.agent(app);
    const { state } = await beginGoogle(agent);

    const response = await callback(agent, state);

    expect(response.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/dashboard`);
    expect((await User.findById(existing.id)).email).toBe('new@example.test');
  });

  it.each([
    ['conflicting changed email', async () => {
      await createUserFixture({
        authProvider: 'google', googleId: 'google-subject-123', email: 'old@example.test', password: undefined,
      });
      await createUserFixture({ email: 'person@example.test' });
    }],
    ['local email collision', async () => createUserFixture({ email: 'person@example.test' })],
    ['different-subject email collision', async () => createUserFixture({
      authProvider: 'google', googleId: 'other-subject', email: 'person@example.test', password: undefined,
    })],
    ['inactive subject', async () => createUserFixture({
      authProvider: 'google', googleId: 'google-subject-123', email: 'person@example.test', password: undefined, isActive: false,
    })],
  ])('fails generically without linking or sessions for %s', async (_label, arrange) => {
    await arrange();
    vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockResolvedValue(successProfile());
    const agent = request.agent(app);
    const { state } = await beginGoogle(agent);

    const response = await callback(agent, state);

    expect(response.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/login?error=google_auth_failed`);
    expect(sessionCookies(response)).toHaveLength(0);
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it.each([
    ['unverified email', { emailVerified: false }],
    ['missing email', { email: undefined }],
    ['missing subject', { googleId: undefined }],
  ])('rejects provider profile with %s without issuing sessions', async (_label, override) => {
    vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockResolvedValue(successProfile(override));
    const agent = request.agent(app);
    const { state } = await beginGoogle(agent);

    const response = await callback(agent, state);

    expect(response.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/login?error=google_auth_failed`);
    expect(sessionCookies(response)).toHaveLength(0);
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it.each([
    ['missing state', async (agent) => agent.get('/api/v1/auth/google/callback').query({ code: 'code' })],
    ['mismatched state', async (agent) => {
      await beginGoogle(agent);
      return callback(agent, '1123456789abcdef0123456789abcdef');
    }],
    ['expired state', async (agent) => {
      const state = '0123456789abcdef0123456789abcdef';
      return request(app)
        .get('/api/v1/auth/google/callback')
        .set('Cookie', signedStateCookie(state, Date.now() - (6 * 60 * 1000)))
        .query({ code: 'code', state });
    }],
  ])('rejects %s before calling the provider', async (_label, invoke) => {
    const exchange = vi.spyOn(googleOAuthService, 'exchangeCodeForProfile');
    const response = await invoke(request.agent(app));

    expect(response.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/login?error=google_auth_failed`);
    expect(exchange).not.toHaveBeenCalled();
    expect(sessionCookies(response)).toHaveLength(0);
  });

  it('makes state single-use and rejects replay without issuing another session', async () => {
    vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockResolvedValue(successProfile());
    const agent = request.agent(app);
    const { state } = await beginGoogle(agent);
    const first = await callback(agent, state);
    const replay = await callback(agent, state);

    expect(first.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/dashboard`);
    expect(replay.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/login?error=google_auth_failed`);
    expect(sessionCookies(replay)).toHaveLength(0);
  });

  it('uses one generic redirect and stable log code for provider failure', async () => {
    vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockRejectedValue(new Error('secret provider body'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = request.agent(app);
    const { state } = await beginGoogle(agent);

    const response = await callback(agent, state);

    expect(response.headers.location).toBe(`${process.env.BROWSER_ORIGIN}/login?error=google_auth_failed`);
    expect(sessionCookies(response)).toHaveLength(0);
    expect(log).toHaveBeenCalledWith('Google sign-in failed:', 'PROVIDER_ERROR');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret provider body');
  });
});
