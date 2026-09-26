// How an email change in progress reads, to the person themselves or to an administrator.
const SENDING = new Set(['NOTICE_PENDING', 'NOTICE_SENT']);

export const isSending = (change) => Boolean(change && SENDING.has(change.state));

export const emailChangeMessage = (change, { admin = false } = {}) => {
    if (!change) return null;
    if (isSending(change)) {
        return {
            role: 'status',
            text: admin
                ? `Sending: first a notice to the user's current address, then a confirmation link to ${change.newEmail}.`
                : `Sending: first a notice to your current address, then a confirmation link to ${change.newEmail}.`,
        };
    }
    if (change.state === 'LINK_SENT') {
        return {
            role: 'status',
            text: admin
                ? `Check the user's new inbox at ${change.newEmail}. The address changes when the user opens the link; it expires in 24 hours.`
                : `Check your new inbox at ${change.newEmail}. Your address changes when you open the link; it expires in 24 hours.`,
        };
    }
    if (change.state === 'FAILED') {
        return { role: 'alert', text: `We couldn't send the email for the change to ${change.newEmail}. Try again.` };
    }
    return null;
};
