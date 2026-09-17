const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const STATUS_LABELS = {
    PENDING: 'Pending',
    IN_REVIEW: 'In Review',
    IN_PROGRESS: 'In Progress',
    RESOLVED: 'Resolved',
    REJECTED: 'Rejected',
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

const sendComplaintFiledEmail = async ({ to, name, referenceCode, complaintId }) => {
    if (!resend) return;

    try {
        await resend.emails.send({
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
    } catch (error) {
        console.error('Failed to send report filed email:', error.message);
    }
};

const sendStatusUpdateEmail = async ({ to, name, referenceCode, status, note, complaintId }) => {
    if (!resend) return;

    try {
        const statusLabel = STATUS_LABELS[status] || status;
        const lines = [
            `Hi ${escapeHtml(name)},`,
            `Your report <strong>${escapeHtml(referenceCode)}</strong> has been updated to: <strong>${escapeHtml(statusLabel)}</strong>.`,
        ];
        if (note) lines.push(escapeHtml(note));

        await resend.emails.send({
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
    } catch (error) {
        console.error('Failed to send status update email:', error.message);
    }
};

module.exports = { sendComplaintFiledEmail, sendStatusUpdateEmail };
