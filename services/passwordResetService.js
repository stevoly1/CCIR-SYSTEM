const mongoose = require('mongoose');
const { User } = require('../models');
const { consumeToken, cancelTokens } = require('./accountTokenService');
const { enqueue } = require('./jobs/outbox');
const { endSessions } = require('./sessionService');
const { ensureAccountLifecycleGuard, touchAccountLifecycleGuard } = require('./accountLifecycleGuard');
const { assertPasswordAllowed } = require('../validators/passwordPolicy');
const { invalidOrExpiredToken } = require('../errors/domainErrors');

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
      await enqueue(session, { queue: 'email', type: 'password_changed', refs: { userId: String(user._id) } });
    });
  } finally {
    await session.endSession();
  }
  return user;
};

module.exports = { resetPassword };
