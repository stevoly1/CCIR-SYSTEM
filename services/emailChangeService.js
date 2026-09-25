const mongoose = require('mongoose');
const { User } = require('../models');
const emailService = require('./emailService');
const { BadRequestError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { googleAccount, sameEmail, emailNotSent, invalidOrExpiredToken } = require('../errors/domainErrors');
const { issueToken, consumeToken, cancelTokens } = require('./accountTokenService');
const { verifyCurrentPassword } = require('./currentPasswordService');
const { accountThrottle } = require('./accountThrottle');
const { requireActiveAdministrator } = require('./accountRetirementService');
const { ensureAccountLifecycleGuard, touchAccountLifecycleGuard } = require('./accountLifecycleGuard');
const { getLogger } = require('../utils/logger');

const HOUR_MS = 60 * 60 * 1000;
const addressTaken = () => new ConflictError('An account with this email already exists');

// Nothing changes until the new address confirms, so a mistyped address cannot lock anyone out, and
// the old address is always told (by the controller, even if the caller hangs up). Confirmation does
// not stop someone who controls the new inbox, such as an administrator using their own address:
// the notice to the old address is what reveals that.
const requestEmailChange = async ({ targetUserId, actorUserId, newEmail, currentPassword, self }) => {
  const [target, actor] = await Promise.all([
    User.findById(targetUserId).select('+password'),
    User.findById(actorUserId),
  ]);
  if (!target) throw new NotFoundError('User not found');
  if (self) {
    if (!actor || actor.isActive !== true || actor.retiredAt) throw new ForbiddenError('An active account is required');
  } else {
    requireActiveAdministrator(actor);
    if (String(actor._id) === String(target._id)) {
      throw new BadRequestError('Use your profile settings to change your own email address', 'USE_PROFILE');
    }
  }
  if (target.retiredAt) throw new ConflictError('Retired accounts cannot be changed');
  if (target.authProvider !== 'local') throw googleAccount();
  if (self) await verifyCurrentPassword(target, currentPassword);
  // Counted before the address checks, so this cannot be used to probe which addresses have accounts.
  await accountThrottle().consume('email-change', String(target._id), { limit: 5, windowMs: HOUR_MS });
  if (newEmail === target.email) throw sameEmail();
  if (await User.exists({ email: newEmail })) throw addressTaken();

  const token = await issueToken({ userId: target._id, purpose: 'email_change', newEmail, requestedBy: actor._id });
  const sent = await emailService.sendEmailChangeConfirmation({ to: newEmail, name: target.name, token });
  if (!sent) {
    await cancelTokens({ userId: target._id, purposes: ['email_change'] });
    throw emailNotSent();
  }
  return target;
};

const confirmEmailChange = async ({ token }) => {
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const record = await consumeToken({ token, purpose: 'email_change', session });
      if (!record) throw invalidOrExpiredToken();
      user = await User.findById(record.user).session(session);
      if (!user || user.retiredAt) throw new ConflictError('This account can no longer be changed');
      if (user.authProvider !== 'local') throw googleAccount();
      if (await User.exists({ _id: { $ne: user._id }, email: record.newEmail }).session(session)) throw addressTaken();
      user.email = record.newEmail;
      await user.save({ session });
      // Reset links went to the old address; none may outlive the change.
      await cancelTokens({ userId: user._id, session });
    });
  } catch (error) {
    if (error?.code === 11000) throw addressTaken();
    throw error;
  } finally {
    await session.endSession();
  }
  getLogger().info({ event: 'email_changed', userId: String(user._id) }, 'Email address changed');
  return user;
};

module.exports = { requestEmailChange, confirmEmailChange };
