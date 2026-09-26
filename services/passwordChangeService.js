const mongoose = require('mongoose');
const { User } = require('../models');
const { ForbiddenError } = require('../errors');
const { googleAccount, samePassword } = require('../errors/domainErrors');
const { verifyCurrentPassword } = require('./currentPasswordService');
const { endSessions } = require('./sessionService');
const { cancelTokens } = require('./accountTokenService');
const { enqueue } = require('./jobs/outbox');
const { ensureAccountLifecycleGuard, touchAccountLifecycleGuard } = require('./accountLifecycleGuard');
const { assertPasswordAllowed } = require('../validators/passwordPolicy');

// This session stays signed in; every other one ends, and pending links are cancelled.
const changePassword = async ({ userId, sessionId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+password');
  if (!user || user.retiredAt || user.isActive !== true) throw new ForbiddenError('An active account is required');
  if (user.authProvider !== 'local') throw googleAccount();
  await verifyCurrentPassword(user, currentPassword);
  if (await user.comparePassword(newPassword)) throw samePassword();
  assertPasswordAllowed(newPassword, { email: user.email });

  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const fresh = await User.findById(userId).select('+password').session(session);
      fresh.password = newPassword;
      await fresh.save({ session });
      await endSessions({ userId, exceptSessionId: sessionId, session });
      await cancelTokens({ userId, session });
      await enqueue(session, { queue: 'email', type: 'password_changed', refs: { userId: String(userId) } });
    });
  } finally {
    await session.endSession();
  }
  return user;
};

module.exports = { changePassword };
