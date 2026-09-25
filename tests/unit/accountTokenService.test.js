const crypto = require('node:crypto');
const { newToken, hashToken, TOKEN_TTL_MS } = require('../../services/accountTokenService');

describe('account token helpers', () => {
  it('makes 43-character base64url tokens that differ each time', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it('stores only the SHA-256 of the token', () => {
    expect(hashToken('abc')).toBe(crypto.createHash('sha256').update('abc').digest('hex'));
  });

  it('gives reset links 30 minutes and email confirmations 24 hours', () => {
    expect(TOKEN_TTL_MS).toEqual({ password_reset: 30 * 60 * 1000, email_change: 24 * 60 * 60 * 1000 });
  });
});
