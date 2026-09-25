const { StatusCodes } = require('http-status-codes');
const emailService = require('../services/emailService');
const passwordResetService = require('../services/passwordResetService');
const passwordChangeService = require('../services/passwordChangeService');
const { accountThrottle, AUTH_WINDOW_MS } = require('../services/accountThrottle');
const { afterResponse } = require('../utils/afterResponse');
const { clearAttachedCookies } = require('../handlers/authHandler');

const HOUR_MS = 60 * 60 * 1000;
const FORGOT_MESSAGE = 'If an account uses this address, we have sent it a link to reset the password.';

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    await accountThrottle().consume('reset-ip', req.ip, { limit: 10, windowMs: AUTH_WINDOW_MS });
    // Counted for every address, so the limit itself reveals nothing.
    await accountThrottle().consume('reset-email', email, { limit: 3, windowMs: HOUR_MS });
    afterResponse(res, () => passwordResetService.sendPasswordResetFor(email));
    res.status(StatusCodes.ACCEPTED).json({ msg: FORGOT_MESSAGE });
};

const resetPassword = async (req, res) => {
    await accountThrottle().consume('token-ip', req.ip, { limit: 20, windowMs: AUTH_WINDOW_MS });
    const user = await passwordResetService.resetPassword(req.body);
    await accountThrottle().clear('login-account', user.email);
    afterResponse(res, () => emailService.sendPasswordChangedEmail({ to: user.email, name: user.name }));
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
    afterResponse(res, () => emailService.sendPasswordChangedEmail({ to: user.email, name: user.name }));
    res.status(StatusCodes.OK).json({ msg: 'Password changed' });
};

module.exports = { forgotPassword, resetPassword, changePassword };
