const {
  safeStateEqual,
  validateGoogleProfile,
} = require('../../policies/googleIdentityPolicy');

const validProfile = {
  googleId: 'google-subject-123',
  email: ' Person@Example.COM ',
  emailVerified: true,
  name: 'Example Person',
  avatarUrl: 'https://images.example/person.png',
};

describe('Google identity policy', () => {
  it('normalizes a verified profile into the owned identity fields', () => {
    expect(validateGoogleProfile(validProfile)).toEqual({
      googleId: 'google-subject-123',
      email: 'person@example.com',
      name: 'Example Person',
      avatarUrl: 'https://images.example/person.png',
    });
  });

  it.each([
    ['missing subject', { googleId: undefined }],
    ['blank subject', { googleId: '   ' }],
    ['missing email', { email: undefined }],
    ['invalid email', { email: 'not-an-email' }],
    ['unverified email', { emailVerified: false }],
    ['missing verification', { emailVerified: undefined }],
    ['unknown claim', { hostedDomain: 'example.com' }],
    ['invalid avatar URL', { avatarUrl: 'javascript:alert(1)' }],
  ])('rejects %s', (_label, override) => {
    expect(() => validateGoogleProfile({ ...validProfile, ...override })).toThrow();
  });

  it('supplies a bounded fallback display name when the optional name is absent', () => {
    expect(validateGoogleProfile({
      ...validProfile,
      email: 'x@example.com',
      name: undefined,
      avatarUrl: undefined,
    })).toMatchObject({ name: 'Google user', avatarUrl: undefined });
  });

  it('compares only equal-length hexadecimal state nonces safely', () => {
    const nonce = '0123456789abcdef0123456789abcdef';
    expect(safeStateEqual(nonce, nonce)).toBe(true);
    expect(safeStateEqual(nonce, '1123456789abcdef0123456789abcdef')).toBe(false);
    expect(safeStateEqual(nonce, `${nonce}00`)).toBe(false);
    expect(safeStateEqual('not-hex', 'not-hex')).toBe(false);
    expect(safeStateEqual(undefined, nonce)).toBe(false);
  });
});
