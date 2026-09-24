const { getBrowserSecurityConfig } = require('../../config/browserSecurity');
const requireApprovedOrigin = require('../../middleware/originGuard');

const corsDecision = (corsOptions, origin) => new Promise((resolve) => {
  corsOptions.origin(origin, (error, allowed) => resolve({ error, allowed }));
});

describe('browser security configuration', () => {
  // Safari applies upgrade-insecure-requests to http://localhost too, so a plain-HTTP development
  // server that sent it had every script and stylesheet fetched over https, and failed (a blank page).
  it.each([
    ['http://localhost:3000', 'development', false],
    ['https://app.example', 'development', true],
    ['https://app.example', 'production', true],
  ])('asks browsers to upgrade to HTTPS only when the origin %s uses it (%s)', (origin, nodeEnv, expected) => {
    expect(getBrowserSecurityConfig({ NODE_ENV: nodeEnv, BROWSER_ORIGIN: origin, TRUST_PROXY_HOPS: '0' }).upgradeInsecureRequests).toBe(expected);
  });

  it.each([
    [{ NODE_ENV: 'production', TRUST_PROXY_HOPS: '1' }],
    [{ NODE_ENV: 'production', BROWSER_ORIGIN: 'not a URL', TRUST_PROXY_HOPS: '1' }],
    [{ NODE_ENV: 'production', BROWSER_ORIGIN: 'https://one.example,https://two.example', TRUST_PROXY_HOPS: '1' }],
    [{ NODE_ENV: 'production', BROWSER_ORIGIN: 'https://app.example/path', TRUST_PROXY_HOPS: '1' }],
    [{ NODE_ENV: 'production', BROWSER_ORIGIN: 'http://app.example', TRUST_PROXY_HOPS: '1' }],
  ])('fails closed for invalid production origin %#', (env) => {
    expect(() => getBrowserSecurityConfig(env)).toThrow(/BROWSER_ORIGIN/);
  });

  it.each(['-1', '1.5', 'abc', ''])('rejects invalid proxy hop count %j', (value) => {
    expect(() => getBrowserSecurityConfig({
      NODE_ENV: 'development',
      BROWSER_ORIGIN: 'http://localhost:5173',
      TRUST_PROXY_HOPS: value,
    })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it.each(['http://localhost:5173', 'http://127.0.0.1:3000', 'https://dev.example']) (
    'accepts an exact development origin %s',
    (browserOrigin) => {
      const config = getBrowserSecurityConfig({
        NODE_ENV: 'development',
        BROWSER_ORIGIN: browserOrigin,
        TRUST_PROXY_HOPS: '0',
      });

      expect(config.browserOrigin).toBe(browserOrigin);
      expect(config.trustProxy).toBe(0);
      expect(config.cookieOptions).toEqual({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: false,
        signed: true,
      });
    },
  );

  it('uses secure Lax cookies and the configured proxy hops in production', () => {
    const config = getBrowserSecurityConfig({
      NODE_ENV: 'production',
      BROWSER_ORIGIN: 'https://app.example',
      TRUST_PROXY_HOPS: '2',
    });

    expect(config.trustProxy).toBe(2);
    expect(config.cookieOptions).toMatchObject({
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
      signed: true,
    });
  });

  it('allows only the exact configured credentialed CORS origin', async () => {
    const { corsOptions } = getBrowserSecurityConfig({
      NODE_ENV: 'development',
      BROWSER_ORIGIN: 'http://localhost:5173',
      TRUST_PROXY_HOPS: '0',
    });

    await expect(corsDecision(corsOptions, undefined)).resolves.toEqual({ error: null, allowed: true });
    await expect(corsDecision(corsOptions, 'http://localhost:5173')).resolves.toEqual({ error: null, allowed: true });
    await expect(corsDecision(corsOptions, 'http://localhost:51730')).resolves.toEqual({ error: null, allowed: false });
    expect(corsOptions.credentials).toBe(true);
    expect(corsOptions.exposedHeaders).toEqual(['X-Request-Id']);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('guards unsafe %s requests with exact origin equality', (method) => {
    const previousOrigin = process.env.BROWSER_ORIGIN;
    const previousHops = process.env.TRUST_PROXY_HOPS;
    process.env.BROWSER_ORIGIN = 'http://localhost:5173';
    process.env.TRUST_PROXY_HOPS = '0';
    const next = vi.fn();

    requireApprovedOrigin({ method, get: () => 'http://localhost:51730' }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

    next.mockClear();
    requireApprovedOrigin({ method, get: () => 'http://localhost:5173' }, {}, next);
    expect(next).toHaveBeenCalledWith();

    if (previousOrigin === undefined) delete process.env.BROWSER_ORIGIN;
    else process.env.BROWSER_ORIGIN = previousOrigin;
    if (previousHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = previousHops;
  });

  it('does not require Origin for safe requests', () => {
    const next = vi.fn();
    requireApprovedOrigin({ method: 'GET', get: () => undefined }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
