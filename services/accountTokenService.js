const crypto = require('node:crypto');
const { AccountToken } = require('../models');

const TOKEN_TTL_MS = Object.freeze({
  password_reset: 30 * 60 * 1000,
  email_change: 24 * 60 * 60 * 1000,
});

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// A new link replaces the earlier unused links of the same purpose.
const issueToken = async ({ userId, purpose, requestedBy, newEmail, session, now = new Date() }) => {
  await AccountToken.deleteMany({ user: userId, purpose, usedAt: null }, { session });
  const token = newToken();
  await AccountToken.create([{
    purpose,
    user: userId,
    tokenHash: hashToken(token),
    newEmail,
    requestedBy,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]),
  }], { session });
  return token;
};

// One atomic update: of two uses at once, exactly one gets the record.
const consumeToken = async ({ token, purpose, session, now = new Date() }) => {
  if (typeof token !== 'string' || token.length === 0 || token.length > 100) return null;
  return AccountToken.findOneAndUpdate(
    { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after', session },
  );
};

const cancelTokens = ({ userId, purposes, session }) => AccountToken.deleteMany({
  user: userId,
  usedAt: null,
  ...(purposes ? { purpose: { $in: purposes } } : {}),
}, { session });

module.exports = { TOKEN_TTL_MS, newToken, hashToken, issueToken, consumeToken, cancelTokens };
