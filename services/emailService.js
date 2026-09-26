const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Resend } = require('resend');
const { getLogger } = require('../utils/logger');
const { JobError } = require('./jobs/jobError');

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

const clientUrl = (pathAndFragment) => `${process.env.ALLOWED_ORIGIN || ''}${pathAndFragment}`;

// Emails are sent only by background jobs. A failure throws a JobError, and the job decides whether
// to try again; log lines carry the job's codes, never the recipient or the content.
const SEND_TIMEOUT_MS = 15 * 1000;
const QUOTA_WAIT_MS = 60 * 60 * 1000;
const QUOTAS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);
let notConfiguredLogged = false;

const withTimeout = (promise, ms) => {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const retryAfterMs = (headers) => {
    const seconds = Number(headers?.['retry-after']);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
};

// Resend returns failures as { error, headers } rather than throwing. Worth another try: a rate
// limit, a server error, a network failure (no status), and a request with the same key still in
// progress. Anything else (a bad address or sender, a key reused with other content) will not
// change on a retry.
const providerFailure = (error, headers) => {
    const status = Number(error?.statusCode) || null;
    if (status === 429 && QUOTAS.has(error.name)) {
        getLogger().warn({ event: 'email_quota_exceeded', quota: error.name }, 'Email sending quota used up; emails wait');
        return JobError.of('RATE_LIMITED', { retryAfterMs: Math.max(retryAfterMs(headers) ?? 0, QUOTA_WAIT_MS) });
    }
    if (status === 429) return JobError.of('RATE_LIMITED', { retryAfterMs: retryAfterMs(headers) });
    if (status === null) return JobError.of(error?.name === 'application_error' ? 'PROVIDER_DOWN' : 'REJECTED');
    if (status >= 500) return JobError.of('PROVIDER_DOWN');
    if (status === 409 && error.name === 'concurrent_idempotent_requests') return JobError.of('PROVIDER_DOWN');
    return JobError.of('REJECTED');
};

// The one way out for every email: the test outbox, or Resend. Replaceable: the journey server
// swaps send.
const emailTransport = {
    async send({ kind, to, subject, html, links = [], idempotencyKey }) {
        if (outboxDir) {
            fs.mkdirSync(outboxDir, { recursive: true });
            const file = path.join(outboxDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
            fs.writeFileSync(file, JSON.stringify({ kind, to, subject, links, idempotencyKey }));
            return;
        }
        if (!resend) {
            if (!notConfiguredLogged) {
                notConfiguredLogged = true;
                getLogger().warn({ event: 'email_not_configured' }, 'RESEND_API_KEY is not set; emails fail until it is');
            }
            throw JobError.of('NOT_CONFIGURED');
        }
        let result;
        try {
            result = await withTimeout(
                resend.emails.send({ from: process.env.EMAIL_FROM, to, subject, html }, idempotencyKey ? { idempotencyKey } : undefined),
                SEND_TIMEOUT_MS,
            );
        } catch {
            throw JobError.of('PROVIDER_DOWN');
        }
        if (result?.error) throw providerFailure(result.error, result.headers);
    },
};

const deliver = (message) => emailTransport.send(message);

const sendComplaintFiledEmail = ({ to, name, referenceCode, complaintId, idempotencyKey }) => {
    const link = reportUrl(complaintId);
    return deliver({
        kind: 'report_filed',
        to,
        links: [link],
        idempotencyKey,
        subject: `Your report ${referenceCode} has been filed`,
        html: wrapEmail({
            heading: 'Report filed',
            lines: [
                `Hi ${escapeHtml(name)},`,
                `Your report has been filed successfully. Reference number: <strong>${escapeHtml(referenceCode)}</strong>.`,
                'We will let you know by email whenever its status changes.',
            ],
            linkUrl: link,
            linkLabel: 'View your report',
        }),
    });
};

const sendStatusUpdateEmail = ({ to, name, referenceCode, status, publicNote, complaintId, idempotencyKey }) => {
    const link = reportUrl(complaintId);
    const lines = [
        `Hi ${escapeHtml(name)},`,
        `Your report <strong>${escapeHtml(referenceCode)}</strong> has been updated to: <strong>${escapeHtml(STATUS_LABELS[status] || status)}</strong>.`,
    ];
    if (publicNote) lines.push(escapeHtml(publicNote));
    return deliver({
        kind: 'status_update',
        to,
        links: [link],
        idempotencyKey,
        subject: `Update on your report ${referenceCode}`,
        html: wrapEmail({ heading: 'Report updated', lines, linkUrl: link, linkLabel: 'View your report' }),
    });
};

// The token travels after #, which browsers never send to a server, so it cannot reach a log.
const sendVerificationEmail = ({ to, name, token, idempotencyKey }) => {
    const link = clientUrl(`/verify-email#token=${token}`);
    return deliver({
        kind: 'verify_email',
        to,
        links: [link],
        idempotencyKey,
        subject: 'Verify your CCIR email address',
        html: wrapEmail({
            heading: 'Verify your email address',
            lines: [
                `Hi ${escapeHtml(name)},`,
                'Confirm that this is your address to start reporting issues. The link works once and expires in 24 hours.',
                'If you did not create a CCIR account, ignore this email.',
            ],
            linkUrl: link,
            linkLabel: 'Verify my email address',
        }),
    });
};

// Enough to recognise an address without handing it to whoever reads the old inbox.
const maskEmail = (email) => {
    const [local, domain] = String(email).split('@');
    return `${local.slice(0, 1)}•••@${domain}`;
};

// The token travels after #, which browsers never send to a server, so it cannot reach a log.
const sendPasswordResetEmail = ({ to, name, token, idempotencyKey }) => {
    const link = clientUrl(`/reset-password#token=${token}`);
    return deliver({
        kind: 'password_reset',
        to,
        links: [link],
        idempotencyKey,
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

const sendGoogleAccountNoticeEmail = ({ to, name, idempotencyKey }) => deliver({
    kind: 'google_account_notice',
    to,
    idempotencyKey,
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

const sendPasswordChangedEmail = ({ to, name, idempotencyKey }) => deliver({
    kind: 'password_changed',
    to,
    idempotencyKey,
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

const sendEmailChangeConfirmation = ({ to, name, token, idempotencyKey }) => {
    const link = clientUrl(`/confirm-email#token=${token}`);
    return deliver({
        kind: 'email_change_confirmation',
        to,
        links: [link],
        idempotencyKey,
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

const sendEmailChangeNotice = ({ to, name, newEmail, requestedByAdministrator = false, idempotencyKey }) => deliver({
    kind: 'email_change_notice',
    to,
    idempotencyKey,
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
    sendVerificationEmail,
    maskEmail,
    emailTransport,
};
