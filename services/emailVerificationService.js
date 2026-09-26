const { User } = require('../models');
const { inTransaction } = require('../utils/transaction');
const { enqueue } = require('./jobs/outbox');
const { consumeToken } = require('./accountTokenService');
const { accountThrottle } = require('./accountThrottle');
const { alreadyVerified, invalidOrExpiredToken } = require('../errors/domainErrors');

const HOUR_MS = 60 * 60 * 1000;

const queueVerification = (session, userId) => enqueue(session, { queue: 'email', type: 'verify_email', refs: { userId: String(userId) } });

// The link names the address it was sent to; it verifies only while the account still uses it.
const verifyEmail = (token) => inTransaction(async (session) => {
  const record = await consumeToken({ token, purpose: 'email_verify', session });
  if (!record) throw invalidOrExpiredToken();
  const user = await User.findById(record.user).session(session);
  if (!user || user.retiredAt || user.email !== record.newEmail) throw invalidOrExpiredToken();
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await user.save({ session });
  }
  return user;
});

// A fresh link on request; it replaces the previous one when the job makes it.
const resendVerification = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.authProvider !== 'local' || user.emailVerifiedAt) throw alreadyVerified();
  await accountThrottle().consume('verify-resend', String(user._id), { limit: 3, windowMs: HOUR_MS });
  await inTransaction((session) => queueVerification(session, user._id));
};

module.exports = { queueVerification, verifyEmail, resendVerification };
