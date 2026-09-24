const mongoose = require('mongoose');
const {
    verifyAccessToken,
    verifyRefreshToken,
    attachCookiesToResponse,
    clearCookieFromResponse,
} = require('../handlers/authHandler');
const { AuthThrottle, User, RefreshToken } = require('../models');
const CustomError = require('../errors');
const { createThrottleService } = require('../services/authThrottleService');

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authThrottle = createThrottleService({
    model: AuthThrottle,
    hmacSecret: process.env.AUTH_THROTTLE_HMAC_SECRET,
});

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

const rawCookieValue = (req, name) => {
    const prefix = `${name}=`;
    const pair = (req.headers.cookie || '').split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith(prefix));
    if (!pair) return null;
    try {
        return decodeURIComponent(pair.slice(prefix.length));
    } catch {
        return pair.slice(prefix.length);
    }
};

// A session is live while its refresh-token record exists, is valid, and has not expired. Logout,
// suspension, role changes and retirement delete the records, ending every access token at once.
const liveSession = (sessionId, userId) => (
    typeof sessionId === 'string' && mongoose.isObjectIdOrHexString(sessionId)
        ? RefreshToken.exists({ _id: sessionId, user: userId, isValid: true, expiresAt: { $gt: new Date() } })
        : Promise.resolve(null)
);

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
            // A token without a session (issued before sessions were named) falls through to the
            // refresh path below, which issues a session-bound one.
            const [user, session] = await Promise.all([
                loadCurrentUser(payload.userId),
                liveSession(payload.sid, payload.userId),
            ]);
            if (user && session) {
                req.user = currentUserContext(user);
                return next();
            }
        }
        clearCookieFromResponse(res, 'accessToken');
    }

    await authThrottle.consume('refresh-ip', req.ip, { limit: 60, windowMs: AUTH_WINDOW_MS });
    const refreshFingerprint = rawCookieValue(req, 'refreshToken');
    if (refreshFingerprint) {
        const failures = await authThrottle.peek('refresh-token', refreshFingerprint);
        if (failures.count >= 10) throw new CustomError.TooManyRequestsError();
    }

    const rejectRefresh = async () => {
        if (refreshFingerprint) {
            await authThrottle.consume('refresh-token', refreshFingerprint, {
                limit: 10,
                windowMs: AUTH_WINDOW_MS,
            });
        }
        clearCookieFromResponse(res, 'refreshToken');
        throw authenticationFailure();
    };

    if (!refreshToken) {
        return rejectRefresh();
    }

    let refreshPayload;
    try {
        refreshPayload = verifyRefreshToken(refreshToken);
    } catch {
        return rejectRefresh();
    }

    const storedToken = await RefreshToken.findOne({ token: refreshPayload.refreshTokenString });
    const ownershipMatches = storedToken
        && String(storedToken.user) === refreshPayload.userId;
    if (
        !ownershipMatches
        || storedToken.isValid !== true
        || storedToken.expiresAt <= new Date()
    ) {
        return rejectRefresh();
    }

    const user = await loadCurrentUser(refreshPayload.userId);
    if (!user) {
        return rejectRefresh();
    }

    if (refreshFingerprint) await authThrottle.clear('refresh-token', refreshFingerprint);
    attachCookiesToResponse({ res, user, refreshToken, sessionId: storedToken._id.toString() });
    req.user = currentUserContext(user);
    return next();
};

module.exports = { authentication };
