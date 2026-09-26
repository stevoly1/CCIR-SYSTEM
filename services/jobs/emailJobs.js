const { Complaint, OutboxEntry, User } = require('../../models');
const emailService = require('../emailService');
const { registerHandler } = require('./registry');

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

module.exports = { keyFor, sendOnce, markDelivered, canReceiveReportEmails };
