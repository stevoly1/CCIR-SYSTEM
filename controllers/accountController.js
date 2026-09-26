const { StatusCodes } = require('http-status-codes');
const passwordResetService = require('../services/passwordResetService');
const passwordChangeService = require('../services/passwordChangeService');
const emailChangeService = require('../services/emailChangeService');
const { accountThrottle, AUTH_WINDOW_MS } = require('../services/accountThrottle');
const { inTransaction } = require('../utils/transaction');
const { enqueue } = require('../services/jobs/outbox');
const { clearAttachedCookies } = require('../handlers/authHandler');

const HOUR_MS = 60 * 60 * 1000;
const FORGOT_MESSAGE = 'If an account uses this address, we have sent it a link to reset the password.';

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    await accountThrottle().consume('reset-ip', req.ip, { limit: 10, windowMs: AUTH_WINDOW_MS });
    // Counted for every address, so the limit itself reveals nothing.
    await accountThrottle().consume('reset-email', email, { limit: 3, windowMs: HOUR_MS });
    // One entry for every address: the request does the same work whether or not an account exists.
    await inTransaction((session) => enqueue(session, { queue: 'email', type: 'password_reset_request', refs: { email } }));
    res.status(StatusCodes.ACCEPTED).json({ msg: FORGOT_MESSAGE });
};

const resetPassword = async (req, res) => {
    await accountThrottle().consume('token-ip', req.ip, { limit: 20, windowMs: AUTH_WINDOW_MS });
    const user = await passwordResetService.resetPassword(req.body);
    await accountThrottle().clear('login-account', user.email);
    clearAttachedCookies(res);
    res.status(StatusCodes.OK).json({ msg: 'Password reset. Sign in with your new password.' });
};

const changePassword = async (req, res) => {
    const user = await passwordChangeService.changePassword({
        userId: req.user.userId,
        sessionId: req.user.sessionId,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
    });
    res.status(StatusCodes.OK).json({ msg: 'Password changed' });
};

const CHANGE_ACCEPTED = 'We will tell your current address, then send a confirmation link to the new one';
const accepted = (res, change) => res.status(StatusCodes.ACCEPTED).json({
    msg: CHANGE_ACCEPTED,
    pendingEmailChange: { newEmail: change.newEmail, state: change.state },
});

const requestOwnEmailChange = async (req, res) => {
    const change = await emailChangeService.requestEmailChange({
        targetUserId: req.user.userId,
        actorUserId: req.user.userId,
        newEmail: req.body.newEmail,
        currentPassword: req.body.currentPassword,
        self: true,
    });
    accepted(res, change);
};

const requestUserEmailChange = async (req, res) => {
    const change = await emailChangeService.requestEmailChange({
        targetUserId: req.params.id,
        actorUserId: req.user.userId,
        newEmail: req.body.newEmail,
        self: false,
    });
    accepted(res, change);
};

const confirmEmailChange = async (req, res) => {
    await accountThrottle().consume('token-ip', req.ip, { limit: 20, windowMs: AUTH_WINDOW_MS });
    await emailChangeService.confirmEmailChange(req.body);
    res.status(StatusCodes.OK).json({ msg: 'Email address changed' });
};

module.exports = { forgotPassword, resetPassword, changePassword, requestOwnEmailChange, requestUserEmailChange, confirmEmailChange };
