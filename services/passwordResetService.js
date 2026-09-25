const mongoose = require('mongoose');
const { User } = require('../models');
const emailService = require('./emailService');
const { issueToken, consumeToken, cancelTokens } = require('./accountTokenService');
const { endSessions } = require('./sessionService');
const { ensureAccountLifecycleGuard, touchAccountLifecycleGuard } = require('./accountLifecycleGuard');
const { assertPasswordAllowed } = require('../validators/passwordPolicy');
const { invalidOrExpiredToken } = require('../errors/domainErrors');

// Runs after the response (see the controller), so its time and outcome reveal nothing.
const sendPasswordResetFor = async (email) => {
  const user = await User.findOne({ email });
  if (!user || user.retiredAt || user.isActive !== true) return;
  if (user.authProvider === 'google') {
    await emailService.sendGoogleAccountNoticeEmail({ to: user.email, name: user.name });
    return;
  }
  const token = await issueToken({ userId: user._id, purpose: 'password_reset', requestedBy: user._id });
  await emailService.sendPasswordResetEmail({ to: user.email, name: user.name, token });
};

// A refused password aborts the transaction, so the link stays usable for a better one.
const resetPassword = async ({ token, password }) => {
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const record = await consumeToken({ token, purpose: 'password_reset', session });
      if (!record) throw invalidOrExpiredToken();
      user = await User.findById(record.user).select('+password').session(session);
      if (!user || user.retiredAt || user.isActive !== true || user.authProvider !== 'local') throw invalidOrExpiredToken();
      assertPasswordAllowed(password, { email: user.email });
      user.password = password;
      await user.save({ session });
      await endSessions({ userId: user._id, session });
      await cancelTokens({ userId: user._id, session });
    });
  } finally {
    await session.endSession();
  }
  return user;
};

module.exports = { sendPasswordResetFor, resetPassword };
