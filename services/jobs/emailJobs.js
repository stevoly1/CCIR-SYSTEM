const { Complaint, OutboxEntry, User } = require('../../models');
const emailService = require('../emailService');
const { registerHandler } = require('./registry');
const { accountThrottle } = require('../accountThrottle');
const { TooManyRequestsError } = require('../../errors');
const { inTransaction } = require('../../utils/transaction');
const { issueTokenRecord } = require('../accountTokenService');
const { ensureAccountLifecycleGuard, touchAccountLifecycleGuard } = require('../accountLifecycleGuard');
const { getLogger } = require('../../utils/logger');

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

const canReceiveReportEmails = (user) => Boolean(user && !user.retiredAt);

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
});

registerHandler('password_changed', {
  queue: 'email',
  run: async (entry) => {
    const user = await User.findById(entry.refs.userId);
    if (!user || user.retiredAt) return;
    await sendOnce(entry, () => emailService.sendPasswordChangedEmail({ to: user.email, name: user.name, idempotencyKey: keyFor(entry) }));
  },
});

module.exports = { keyFor, sendOnce, markDelivered, canReceiveReportEmails, withinRecipientCap, issueLinkFor };
