const mongoose = require('mongoose');
const { EmailChange, User } = require('../models');
const { BadRequestError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { googleAccount, sameEmail, invalidOrExpiredToken } = require('../errors/domainErrors');
const { consumeToken, cancelTokens } = require('./accountTokenService');
const { endActiveChanges } = require('./emailChangeState');
const { inTransaction } = require('../utils/transaction');
const { enqueue } = require('./jobs/outbox');
const { verifyCurrentPassword } = require('./currentPasswordService');
const { accountThrottle } = require('./accountThrottle');
const { requireActiveAdministrator } = require('./accountRetirementService');
const { ensureAccountLifecycleGuard, touchAccountLifecycleGuard } = require('./accountLifecycleGuard');
const { getLogger } = require('../utils/logger');

const HOUR_MS = 60 * 60 * 1000;
const addressTaken = () => new ConflictError('An account with this email already exists');

// Nothing changes until the new address confirms, so a mistyped address cannot lock anyone out.
// Confirmation does not stop someone who controls the new inbox, such as an administrator using their
// own address: the notice to the old address is what reveals that. So background jobs tell the old
// address first and only then send the link; if either cannot be sent, the change fails and no link
// is kept. The request itself only records the change (see EmailChange).
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

  await ensureAccountLifecycleGuard();
  return inTransaction(async (session) => {
    await touchAccountLifecycleGuard(session);
    await endActiveChanges({ userId: target._id, state: 'SUPERSEDED', session });
    await cancelTokens({ userId: target._id, purposes: ['email_change'], session });
    const [change] = await EmailChange.create([{
      user: target._id, newEmail, requestedBy: actor._id, byAdministrator: !self, state: 'NOTICE_PENDING', active: true,
    }], { session });
    await enqueue(session, { queue: 'email', type: 'email_change_notice', refs: { emailChangeId: String(change._id) } });
    return change;
  });
};

const confirmEmailChange = async ({ token }) => {
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const record = await consumeToken({ token, purpose: 'email_change', session });
      // The token exists only in the link email, which the link job sends after the notice; the
      // change may not be marked LINK_SENT yet when a quick reader uses it.
      const change = record?.emailChange
        ? await EmailChange.findOne({ _id: record.emailChange, state: { $in: ['NOTICE_SENT', 'LINK_SENT'] }, active: true }).session(session)
        : null;
      if (!change) throw invalidOrExpiredToken();
      user = await User.findById(record.user).session(session);
      if (!user || user.retiredAt || user.isActive !== true) throw invalidOrExpiredToken();
      if (user.authProvider !== 'local') throw googleAccount();
      if (await User.exists({ _id: { $ne: user._id }, email: change.newEmail }).session(session)) throw addressTaken();
      user.email = change.newEmail;
      await user.save({ session });
      // Reset links went to the old address; none may outlive the change.
      await cancelTokens({ userId: user._id, session });
      await EmailChange.updateOne({ _id: change._id }, { $set: { state: 'CONFIRMED', endedAt: new Date() }, $unset: { active: 1 } }, { session });
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

// Each account's latest change, while it is under way or after it failed (so the person can see
// why nothing happened). Confirmed, replaced and cancelled changes are not shown.
const SHOWN_STATES = [...EmailChange.ACTIVE_STATES, 'FAILED'];
const pendingEmailChanges = async (userIds) => {
  const latest = await EmailChange.aggregate([
    { $match: { user: { $in: userIds } } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: '$user', newEmail: { $first: '$newEmail' }, state: { $first: '$state' } } },
  ]);
  return new Map(latest
    .filter((change) => SHOWN_STATES.includes(change.state))
    .map((change) => [String(change._id), { newEmail: change.newEmail, state: change.state }]));
};

module.exports = { requestEmailChange, confirmEmailChange, pendingEmailChanges };
