const { createGoogleAgent } = require('../helpers/googleAuth');
const { getBrowserSecurityConfig } = require('../../config/browserSecurity');

describe('Google sign-in return path', () => {
  const origin = () => getBrowserSecurityConfig(process.env).browserOrigin;

  it('returns to the dashboard page that started the sign-in', async () => {
    const { callback } = await createGoogleAgent({ returnTo: '/dashboard/reports/66f1a0c0a1b2c3d4e5f60001' });
    expect(callback.headers.location).toBe(`${origin()}/dashboard/reports/66f1a0c0a1b2c3d4e5f60001`);
  });

  it.each(['https://evil.example/', '//evil.example', '/login', '/dashboard/../login'])(
    'ignores %s and returns to the dashboard',
    async (returnTo) => {
      const { start, callback } = await createGoogleAgent({ returnTo });
      expect(start.status).toBe(302);
      expect(callback.headers.location).toBe(`${origin()}/dashboard`);
    },
  );

  it('returns to the dashboard when none was given', async () => {
    const { callback } = await createGoogleAgent();
    expect(callback.headers.location).toBe(`${origin()}/dashboard`);
  });
});
