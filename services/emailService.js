const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Resend } = require('resend');
const { getLogger } = require('../utils/logger');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Journeys read emails from files instead of an inbox. Never outside tests: a misconfigured server
// must fail to start rather than write people's emails to disk.
const outboxDir = process.env.EMAIL_OUTBOX_DIR;
if (outboxDir && process.env.NODE_ENV !== 'test') {
    throw new Error('EMAIL_OUTBOX_DIR is for tests only (NODE_ENV=test)');
}

const STATUS_LABELS = {
    PENDING: 'Pending',
    IN_REVIEW: 'In Review',
    IN_PROGRESS: 'In Progress',
    RESOLVED: 'Resolved',
    REJECTED: 'Rejected',
    WITHDRAWN: 'Withdrawn',
};

const escapeHtml = (value = '') =>
    String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const reportUrl = (complaintId) => {
    const origin = process.env.ALLOWED_ORIGIN || '';
    return `${origin}/dashboard/reports/${complaintId}`;
};

// Plain, minimal layout: white background, black text, one green underlined link, no images.
const wrapEmail = ({ heading, lines, linkUrl, linkLabel }) => `
<div style="background:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; max-width:480px; margin:0 auto; padding:24px;">
  <p style="margin:0 0 20px; font-size:16px; font-weight:bold;">CCIR System</p>
  <h2 style="margin:0 0 16px; font-size:18px;">${heading}</h2>
  ${lines.map((line) => `<p style="margin:0 0 12px; font-size:14px; line-height:1.6;">${line}</p>`).join('')}
  ${linkUrl ? `<p style="margin:20px 0 0; font-size:14px;"><a href="${linkUrl}" style="color:#005C4B; text-decoration:underline;">${linkLabel}</a></p>` : ''}
  <hr style="margin:28px 0 16px; border:none; border-top:1px solid #000000;" />
  <p style="margin:0; font-size:12px;">CCIR System</p>
</div>`;

// Best-effort notifications — never throw, so a mail provider outage never blocks a citizen or staff action.
// Each resolves to true when the provider accepted the message and false otherwise. The Resend SDK
// returns provider and network failures as { error } instead of throwing, so both paths are checked.
// The log line names the message kind and the provider's reason, never the recipient or content.
const logSendFailure = (kind, details) => {
    getLogger().warn({ provider: 'resend', kind, ...details }, 'Email not sent');
};

const sendComplaintFiledEmail = async ({ to, name, referenceCode, complaintId }) => {
    if (!resend) return false;

    try {
        const { error } = await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to,
            subject: `Your report ${referenceCode} has been filed`,
            html: wrapEmail({
                heading: 'Report filed',
                lines: [
                    `Hi ${escapeHtml(name)},`,
                    `Your report has been filed successfully. Reference number: <strong>${escapeHtml(referenceCode)}</strong>.`,
                    'We will let you know by email whenever its status changes.',
                ],
                linkUrl: reportUrl(complaintId),
                linkLabel: 'View your report',
            }),
        });
        if (error) {
            logSendFailure('report_filed', { reason: error.name || 'provider_error', statusCode: error.statusCode });
            return false;
        }
        return true;
    } catch (error) {
        logSendFailure('report_filed', { err: error });
        return false;
    }
};

const sendStatusUpdateEmail = async ({ to, name, referenceCode, status, publicNote, complaintId }) => {
    if (!resend) return false;

    try {
        const statusLabel = STATUS_LABELS[status] || status;
        const lines = [
            `Hi ${escapeHtml(name)},`,
            `Your report <strong>${escapeHtml(referenceCode)}</strong> has been updated to: <strong>${escapeHtml(statusLabel)}</strong>.`,
        ];
        if (publicNote) lines.push(escapeHtml(publicNote));

        const { error } = await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to,
            subject: `Update on your report ${referenceCode}`,
            html: wrapEmail({
                heading: 'Report updated',
                lines,
                linkUrl: reportUrl(complaintId),
                linkLabel: 'View your report',
            }),
        });
        if (error) {
            logSendFailure('status_update', { reason: error.name || 'provider_error', statusCode: error.statusCode });
            return false;
        }
        return true;
    } catch (error) {
        logSendFailure('status_update', { err: error });
        return false;
    }
};

const clientUrl = (pathAndFragment) => `${process.env.ALLOWED_ORIGIN || ''}${pathAndFragment}`;

// The account emails' one way out: the test outbox, or Resend. Resolves true when the message was
// accepted, false otherwise; never throws.
const deliver = async ({ kind, to, subject, html, links = [] }) => {
    if (outboxDir) {
        fs.mkdirSync(outboxDir, { recursive: true });
        const file = path.join(outboxDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
        fs.writeFileSync(file, JSON.stringify({ kind, to, subject, links }));
        return true;
    }
    if (!resend) return false;
    try {
        const { error } = await resend.emails.send({ from: process.env.EMAIL_FROM, to, subject, html });
        if (error) {
            logSendFailure(kind, { reason: error.name || 'provider_error', statusCode: error.statusCode });
            return false;
        }
        return true;
    } catch (error) {
        logSendFailure(kind, { err: error });
        return false;
    }
};

// Enough to recognise an address without handing it to whoever reads the old inbox.
const maskEmail = (email) => {
    const [local, domain] = String(email).split('@');
    return `${local.slice(0, 1)}•••@${domain}`;
};

// The token travels after #, which browsers never send to a server, so it cannot reach a log.
const sendPasswordResetEmail = ({ to, name, token }) => {
    const link = clientUrl(`/reset-password#token=${token}`);
    return deliver({
        kind: 'password_reset',
        to,
        links: [link],
        subject: 'Reset your CCIR password',
        html: wrapEmail({
            heading: 'Reset your password',
            lines: [
                `Hi ${escapeHtml(name)},`,
                'Use the link below to choose a new password. It works once and expires in 30 minutes.',
                'If you did not ask for this, ignore this email; your password stays the same.',
            ],
            linkUrl: link,
            linkLabel: 'Choose a new password',
        }),
    });
};

const sendGoogleAccountNoticeEmail = ({ to, name }) => deliver({
    kind: 'google_account_notice',
    to,
    subject: 'You sign in to CCIR with Google',
    html: wrapEmail({
        heading: 'You sign in with Google',
        lines: [
            `Hi ${escapeHtml(name)},`,
            'Someone asked to reset the password for this address, but this account signs in with Google and has no CCIR password.',
            'Use "Continue with Google" on the sign-in page.',
        ],
    }),
});

const sendPasswordChangedEmail = ({ to, name }) => deliver({
    kind: 'password_changed',
    to,
    subject: 'Your CCIR password was changed',
    html: wrapEmail({
        heading: 'Password changed',
        lines: [
            `Hi ${escapeHtml(name)},`,
            'The password for your account was just changed.',
            'If this was not you, reset your password now and contact an administrator.',
        ],
    }),
});

const sendEmailChangeConfirmation = ({ to, name, token }) => {
    const link = clientUrl(`/confirm-email#token=${token}`);
    return deliver({
        kind: 'email_change_confirmation',
        to,
        links: [link],
        subject: 'Confirm your new CCIR email address',
        html: wrapEmail({
            heading: 'Confirm your email address',
            lines: [
                `Hi ${escapeHtml(name)},`,
                'Confirm that this address should be used for your CCIR account. The link works once and expires in 24 hours.',
                'If you did not ask for this, ignore this email; nothing changes.',
            ],
            linkUrl: link,
            linkLabel: 'Confirm this address',
        }),
    });
};

const sendEmailChangeNotice = ({ to, name, newEmail, requestedByAdministrator = false }) => deliver({
    kind: 'email_change_notice',
    to,
    subject: 'A change to your CCIR email address was requested',
    html: wrapEmail({
        heading: 'Email change requested',
        lines: [
            `Hi ${escapeHtml(name)},`,
            requestedByAdministrator
                ? `An administrator asked to change this account's email address to ${escapeHtml(maskEmail(newEmail))}. It happens only if the new address is confirmed.`
                : `A change of this account's email address to ${escapeHtml(maskEmail(newEmail))} was requested. It happens only if the new address is confirmed.`,
            'If this was not you, contact an administrator.',
        ],
    }),
});

module.exports = {
    sendComplaintFiledEmail,
    sendStatusUpdateEmail,
    sendPasswordResetEmail,
    sendGoogleAccountNoticeEmail,
    sendPasswordChangedEmail,
    sendEmailChangeConfirmation,
    sendEmailChangeNotice,
    maskEmail,
};
