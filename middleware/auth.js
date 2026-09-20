const mongoose = require('mongoose');
const {
    verifyAccessToken,
    verifyRefreshToken,
    attachCookiesToResponse,
    clearCookieFromResponse,
} = require('../handlers/authHandler');
const { User, RefreshToken } = require('../models');
const CustomError = require('../errors');

const authenticationFailure = () => new CustomError.UnauthenticatedError(
    'Session expired, please log in again',
);

const loadCurrentUser = async (userId) => {
    if (typeof userId !== 'string' || !mongoose.isObjectIdOrHexString(userId)) return null;
    const user = await User.findById(userId);
    if (!user || user.isActive !== true || user.retiredAt) return null;
    return user;
};

const currentUserContext = (user) => ({
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    retiredAt: user.retiredAt || null,
});

const authentication = async (req, res, next) => {
    const accessToken = req.signedCookies.accessToken;
    const refreshToken = req.signedCookies.refreshToken;

    // A valid signature identifies the account; current database state supplies authority.
    if (accessToken) {
        let payload;
        try {
            payload = verifyAccessToken(accessToken);
        } catch {}
        if (payload) {
            const user = await loadCurrentUser(payload.userId);
            if (user) {
                req.user = currentUserContext(user);
                return next();
            }
        }
        clearCookieFromResponse(res, 'accessToken');
    }

    if (!refreshToken) {
        throw new CustomError.UnauthenticatedError('Not authenticated');
    }

    let refreshPayload;
    try {
        refreshPayload = verifyRefreshToken(refreshToken);
    } catch {
        clearCookieFromResponse(res, 'refreshToken');
        throw authenticationFailure();
    }

    const storedToken = await RefreshToken.findOne({ token: refreshPayload.refreshTokenString });
    const ownershipMatches = storedToken
        && String(storedToken.user) === refreshPayload.userId;
    if (
        !ownershipMatches
        || storedToken.isValid !== true
        || storedToken.expiresAt <= new Date()
    ) {
        clearCookieFromResponse(res, 'refreshToken');
        throw authenticationFailure();
    }

    const user = await loadCurrentUser(refreshPayload.userId);
    if (!user) {
        clearCookieFromResponse(res, 'refreshToken');
        throw authenticationFailure();
    }

    attachCookiesToResponse({ res, user, refreshToken });
    req.user = currentUserContext(user);
    return next();
};

module.exports = { authentication };
