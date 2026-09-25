const { AccountToken } = require('../../models');
const { createUserFixture } = require('../fixtures/user');
const { issueToken, consumeToken, cancelTokens, hashToken } = require('../../services/accountTokenService');

describe('account tokens', () => {
  let user;
  beforeEach(async () => { user = await createUserFixture(); });
  const issue = (purpose = 'password_reset', extra = {}) => issueToken({ userId: user._id, purpose, requestedBy: user._id, ...extra });

  it('stores the hash, never the token', async () => {
    const token = await issue();
    const [record] = await AccountToken.find({ user: user._id }).lean();
    expect(record.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(record)).not.toContain(token);
  });

  it('is used once', async () => {
    const token = await issue();
    expect(await consumeToken({ token, purpose: 'password_reset' })).not.toBeNull();
    expect(await consumeToken({ token, purpose: 'password_reset' })).toBeNull();
  });

  it('gives exactly one of two simultaneous uses the record', async () => {
    const token = await issue();
    const results = await Promise.all([1, 2].map(() => consumeToken({ token, purpose: 'password_reset' })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('refuses an expired token, the wrong purpose, and junk', async () => {
    const token = await issue('password_reset', { now: new Date(Date.now() - 31 * 60 * 1000) });
    expect(await consumeToken({ token, purpose: 'password_reset' })).toBeNull();
    const fresh = await issue('email_change', { newEmail: 'new@example.test' });
    expect(await consumeToken({ token: fresh, purpose: 'password_reset' })).toBeNull();
    for (const junk of [undefined, '', 'x'.repeat(101), { $ne: null }]) {
      expect(await consumeToken({ token: junk, purpose: 'password_reset' })).toBeNull();
    }
  });

  it('replaces earlier unused tokens of the same purpose only', async () => {
    const first = await issue();
    const change = await issue('email_change', { newEmail: 'new@example.test' });
    await issue();
    expect(await consumeToken({ token: first, purpose: 'password_reset' })).toBeNull();
    expect(await consumeToken({ token: change, purpose: 'email_change' })).not.toBeNull();
  });

  it('cancels unused tokens by purpose or all together', async () => {
    const reset = await issue();
    const change = await issue('email_change', { newEmail: 'new@example.test' });
    await cancelTokens({ userId: user._id, purposes: ['password_reset'] });
    expect(await consumeToken({ token: reset, purpose: 'password_reset' })).toBeNull();
    await cancelTokens({ userId: user._id });
    expect(await consumeToken({ token: change, purpose: 'email_change' })).toBeNull();
  });
});
