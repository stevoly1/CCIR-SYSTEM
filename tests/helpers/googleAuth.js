const request = require('supertest');
const googleOAuthService = require('../../services/googleOAuthService');
const { testServer } = require('./testServer');

let sequence = 0;

// Signs a new Google account in through the real redirect and callback, with Google's token
// exchange replaced. Returns the agent holding the session cookies.
const createGoogleAgent = async ({ returnTo } = {}) => {
  sequence += 1;
  const profile = {
    googleId: `google-helper-${sequence}`,
    email: `google-helper-${sequence}@example.test`,
    emailVerified: true,
    name: `Google Helper ${sequence}`,
  };
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
  vi.stubEnv('GOOGLE_CALLBACK_URL', 'http://localhost:8080/api/v1/auth/google/callback');
  const exchange = vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockResolvedValue(profile);
  try {
    const agent = request.agent(testServer());
    const start = await agent.get('/api/v1/auth/google').query(returnTo === undefined ? {} : { returnTo });
    const state = new URL(start.headers.location).searchParams.get('state');
    const callback = await agent.get('/api/v1/auth/google/callback').query({ code: 'test-code', state });
    if (!(callback.headers['set-cookie'] || []).some((cookie) => cookie.startsWith('accessToken='))) {
      throw new Error(`Google test sign-in failed: ${callback.status} ${callback.headers.location}`);
    }
    return { agent, profile, start, callback };
  } finally {
    exchange.mockRestore();
    vi.unstubAllEnvs();
  }
};

module.exports = { createGoogleAgent };
