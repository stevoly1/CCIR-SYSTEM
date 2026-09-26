const { AccountToken, Complaint, EmailChange, OutboxEntry, User } = require('../../models');
const emailService = require('../emailService');
const { registerHandler } = require('./registry');
const { accountThrottle } = require('../accountThrottle');
const { TooManyRequestsError } = require('../../errors');
const { inTransaction } = require('../../utils/transaction');
const { issueTokenRecord } = require('../accountTokenService');
const { ensureAccountLifecycleGuard, touchAccountLifecycleGuard } = require('../accountLifecycleGuard');
const { getLogger } = require('../../utils/logger');
const { JobError } = require('./jobError');
const { enqueue } = require('./outbox');
const { jobCannotRetry } = require('../../errors/domainErrors');

const HOUR_MS = 60 * 60 * 1000;

// Email jobs. Each is safe to run twice: sendOnce records the send, and Resend drops a repeated
// idempotency key for 24 hours, which covers a send that succeeded just before a crash.
const keyFor = (entry) => `email-${entry._id}-${entry.runKey}`;

const markDelivered = async (entry) => {
  const now = new Date();
  await OutboxEntry.updateOne({ _id: entry._id }, { $set: { deliveredAt: now } });
  entry.deliveredAt = now;
};

const sendOnce = async (entry, send) => {
  if (entry.deliveredAt) return false;
  await send();
  await markDelivered(entry);
  return true;
};

// Report emails go only to an address the account holder has proved.
const canReceiveReportEmails = (user) => Boolean(user && !user.retiredAt && (user.emailVerifiedAt || user.authProvider === 'google'));

const reportAndReporter = async (complaintId, fields) => {
  const complaint = await Complaint.findById(complaintId).select(`referenceCode reporter ${fields}`.trim());
  if (!complaint) return {};
  return { complaint, reporter: await User.findById(complaint.reporter) };
};

registerHandler('report_filed', {
  queue: 'email',
  run: async (entry) => {
    const { complaint, reporter } = await reportAndReporter(entry.refs.complaintId, '');
    if (!complaint || !canReceiveReportEmails(reporter)) return;
    await sendOnce(entry, () => emailService.sendComplaintFiledEmail({
      to: reporter.email, name: reporter.name, referenceCode: complaint.referenceCode, complaintId: complaint._id, idempotencyKey: keyFor(entry),
    }));
  },
});

// The email carries the change it was queued for, not whatever the report says by the time it runs.
registerHandler('status_update', {
  queue: 'email',
  run: async (entry) => {
    const { complaint, reporter } = await reportAndReporter(entry.refs.complaintId, 'statusHistory');
    const change = complaint?.statusHistory.id(entry.refs.historyEntryId);
    if (!change || !canReceiveReportEmails(reporter)) return;
    await sendOnce(entry, () => emailService.sendStatusUpdateEmail({
      to: reporter.email, name: reporter.name, referenceCode: complaint.referenceCode,
      status: change.status, publicNote: change.publicNote ?? null, complaintId: complaint._id, idempotencyKey: keyFor(entry),
    }));
  },
});

// Link emails (reset, email-change link, verification) to one address, whoever asks for them.
// Counted on a request's first attempt only, so retries after a provider failure are never capped.
const withinRecipientCap = async (entry, address) => {
  if (entry.attempts > 0) return true;
  try {
    await accountThrottle().consume('link-recipient', address, { limit: 3, windowMs: HOUR_MS });
    return true;
  } catch (error) {
    if (!(error instanceof TooManyRequestsError)) throw error;
    getLogger().info({ event: 'recipient_capped', type: entry.type }, 'Link email not sent: this address had three this hour');
    return false;
  }
};

// Made inside the lifecycle guard, so a link cannot appear after a concurrent password or email
// change has cancelled the account's links; and only while the account still uses this address.
// Each attempt makes a fresh link under a fresh idempotency key, replacing the previous attempt's.
const issueLinkFor = async ({ userId, email, purpose, requestedBy, newEmail, emailChange }) => {
  await ensureAccountLifecycleGuard();
  return inTransaction(async (session) => {
    await touchAccountLifecycleGuard(session);
    const user = await User.findById(userId).session(session);
    if (!user || user.retiredAt || user.isActive !== true || user.email !== email) return null;
    return issueTokenRecord({ userId, purpose, requestedBy: requestedBy ?? userId, newEmail, emailChange, session });
  });
};

// The request answered the same for every address; the lookup happens here, after the answer.
registerHandler('password_reset_request', {
  queue: 'email',
  run: async (entry) => {
    const { email } = entry.refs;
    if (entry.deliveredAt || !email) return;
    const user = await User.findOne({ email });
    if (!user || user.retiredAt || user.isActive !== true) return;
    if (user.authProvider === 'google') {
      await sendOnce(entry, () => emailService.sendGoogleAccountNoticeEmail({ to: user.email, name: user.name, idempotencyKey: keyFor(entry) }));
      return;
    }
    if (!(await withinRecipientCap(entry, email))) return;
    const link = await issueLinkFor({ userId: user._id, email, purpose: 'password_reset' });
    if (!link) return;
    await emailService.sendPasswordResetEmail({ to: email, name: user.name, token: link.token, idempotencyKey: `link-${link.record._id}` });
    await markDelivered(entry);
  },
  // A failed request forgets its address; the person asks again instead.
  onRetry: async (entry) => {
    if (!entry.refs.email) throw jobCannotRetry();
  },
});

registerHandler('password_changed', {
  queue: 'email',
  run: async (entry) => {
    const user = await User.findById(entry.refs.userId);
    if (!user || user.retiredAt) return;
    await sendOnce(entry, () => emailService.sendPasswordChangedEmail({ to: user.email, name: user.name, idempotencyKey: keyFor(entry) }));
  },
});

const endChange = (changeId, state, failedCode) => EmailChange.updateOne(
  { _id: changeId, active: true },
  { $set: { state, endedAt: new Date(), ...(failedCode ? { failedCode } : {}) }, $unset: { active: 1 } },
);

// An email that cannot be sent ends the change: nothing changed, and no link may outlive it.
const failChange = async (changeId, code) => {
  const change = await EmailChange.findById(changeId);
  if (!change) return;
  await endChange(change._id, 'FAILED', code);
  await AccountToken.deleteMany({ user: change.user, purpose: 'email_change', emailChange: change._id, usedAt: null });
};

// An administrator's retry (the Jobs page) puts a failed change back where its job left off. The
// change may also still be in that state, if its final-failure step itself failed. A newer change
// for the account, which holds the one active slot, stops it.
const reopenChange = (state) => async (entry, session) => {
  let reopened;
  try {
    reopened = await EmailChange.updateOne(
      { _id: entry.refs.emailChangeId, $or: [{ state: 'FAILED' }, { state, active: true }] },
      { $set: { state, active: true }, $unset: { failedCode: 1, endedAt: 1 } },
      { session },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    reopened = { matchedCount: 0 };
  }
  if (reopened.matchedCount !== 1) throw jobCannotRetry();
};

const changeAndUser = async (entry, expectedState) => {
  const change = await EmailChange.findById(entry.refs.emailChangeId);
  if (!change || change.state !== expectedState || !change.active) return {};
  const user = await User.findById(change.user);
  if (!user || user.retiredAt || user.isActive !== true || user.authProvider !== 'local') {
    await endChange(change._id, 'CANCELLED');
    return {};
  }
  return { change, user };
};

registerHandler('email_change_notice', {
  queue: 'email',
  run: async (entry) => {
    const { change, user } = await changeAndUser(entry, 'NOTICE_PENDING');
    if (!change) return;
    await sendOnce(entry, () => emailService.sendEmailChangeNotice({
      to: user.email, name: user.name, newEmail: change.newEmail, requestedByAdministrator: change.byAdministrator, idempotencyKey: keyFor(entry),
    }));
    // Only now may the link be sent: the move and the link job are written together.
    await inTransaction(async (session) => {
      const moved = await EmailChange.updateOne({ _id: change._id, state: 'NOTICE_PENDING', active: true }, { $set: { state: 'NOTICE_SENT' } }, { session });
      if (moved.modifiedCount === 1) {
        await enqueue(session, { queue: 'email', type: 'email_change_link', refs: { emailChangeId: String(change._id) } });
      }
    });
    getLogger().info({ event: 'email_change_requested', userId: String(change.user), requestedBy: String(change.requestedBy) }, 'Email change requested');
  },
  onFinalFailure: (entry, code) => failChange(entry.refs.emailChangeId, code),
  onRetry: reopenChange('NOTICE_PENDING'),
});

registerHandler('email_change_link', {
  queue: 'email',
  run: async (entry) => {
    const { change, user } = await changeAndUser(entry, 'NOTICE_SENT');
    if (!change) return;
    if (!entry.deliveredAt) {
      // Over the recipient cap the change fails, visibly, rather than waiting for ever.
      if (!(await withinRecipientCap(entry, change.newEmail))) throw JobError.of('RECIPIENT_CAPPED');
      const link = await issueLinkFor({
        userId: user._id, email: user.email, purpose: 'email_change', requestedBy: change.requestedBy, newEmail: change.newEmail, emailChange: change._id,
      });
      if (!link) {
        await endChange(change._id, 'CANCELLED');
        return;
      }
      await emailService.sendEmailChangeConfirmation({ to: change.newEmail, name: user.name, token: link.token, idempotencyKey: `link-${link.record._id}` });
      await markDelivered(entry);
    }
    await EmailChange.updateOne({ _id: change._id, state: 'NOTICE_SENT', active: true }, { $set: { state: 'LINK_SENT' } });
  },
  onFinalFailure: (entry, code) => failChange(entry.refs.emailChangeId, code),
  // The failed change's link was removed, so a retry makes and sends a fresh one even if the
  // earlier link email went out.
  onRetry: async (entry, session) => {
    await reopenChange('NOTICE_SENT')(entry, session);
    await OutboxEntry.updateOne({ _id: entry._id }, { $unset: { deliveredAt: 1 } }, { session });
  },
});

// The link names the address it was sent to, and verifies only while the account still uses it.
registerHandler('verify_email', {
  queue: 'email',
  run: async (entry) => {
    if (entry.deliveredAt) return;
    const user = await User.findById(entry.refs.userId);
    if (!user || user.retiredAt || user.isActive !== true || user.authProvider !== 'local' || user.emailVerifiedAt) return;
    if (!(await withinRecipientCap(entry, user.email))) return;
    const link = await issueLinkFor({ userId: user._id, email: user.email, purpose: 'email_verify', newEmail: user.email });
    if (!link) return;
    await emailService.sendVerificationEmail({ to: user.email, name: user.name, token: link.token, idempotencyKey: `link-${link.record._id}` });
    await markDelivered(entry);
  },
});

module.exports = { keyFor, sendOnce, markDelivered, canReceiveReportEmails, withinRecipientCap, issueLinkFor };
