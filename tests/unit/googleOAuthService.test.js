const googleOAuthService = require('../../services/googleOAuthService');

const response = (ok, body) => ({
  ok,
  json: vi.fn().mockResolvedValue(body),
});

describe('Google OAuth provider boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the current userinfo claims into the internal profile contract', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(true, { access_token: 'provider-access-token' }))
      .mockResolvedValueOnce(response(true, {
        sub: 'subject-1',
        email: 'person@example.test',
        email_verified: true,
        name: 'Person',
        picture: 'https://images.example/person.png',
      }));
    vi.stubGlobal('fetch', fetch);

    await expect(googleOAuthService.exchangeCodeForProfile('one-time-code')).resolves.toEqual({
      googleId: 'subject-1',
      email: 'person@example.test',
      emailVerified: true,
      name: 'Person',
      avatarUrl: 'https://images.example/person.png',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not expose token endpoint bodies in its stable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, {
      error: 'invalid_grant',
      error_description: 'secret provider diagnostic',
    })));

    await expect(googleOAuthService.exchangeCodeForProfile('bad-code')).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_FAILED',
      message: 'TOKEN_EXCHANGE_FAILED',
    });
  });

  it('maps transport failures to a stable provider error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network secret')));
    await expect(googleOAuthService.exchangeCodeForProfile('code')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'PROVIDER_ERROR',
    });
  });
});
