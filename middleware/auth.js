const {
    verifyAccessToken,
    verifyRefreshToken,
    attachCookiesToResponse,
} = require('../handlers/authHandler');
const { User, RefreshToken } = require('../models');
const CustomError = require('../errors');

const authentication = async (req, res, next) => {
    const accessToken = req.signedCookies.accessToken;
    const refreshToken = req.signedCookies.refreshToken;

    // Case 1: valid access token — proceed normally
    if (accessToken) {
        try {
            const payload = verifyAccessToken(accessToken);
            req.user = payload;
            return next();
        } catch (err) {
            // expired or tampered — clear it, fall through to refresh attempt
            res.clearCookie('accessToken');
        }
    }

    // Case 2: no (valid) access token — try the refresh token
    if (!refreshToken) {
        throw new CustomError.UnauthenticatedError('Not authenticated');
    }

    let refreshPayload;
    try {
        refreshPayload = verifyRefreshToken(refreshToken);
    } catch (err) {
        res.clearCookie('refreshToken');
        throw new CustomError.UnauthenticatedError('Session expired, please log in again');
    }

    const storedToken = await RefreshToken.findOne({ token: refreshPayload.refreshTokenString });

    if (!storedToken || !storedToken.isValid) {
        res.clearCookie('refreshToken');
        throw new CustomError.UnauthenticatedError('Session expired, please log in again');
    }

    const user = await User.findById(refreshPayload.userId);

    if (!user) {
        throw new CustomError.UnauthenticatedError('Session expired, please log in again');
    }

    // issue a fresh access token (reuse same refresh token — no need to rotate it here)
    attachCookiesToResponse({ res, user, refreshToken });

    req.user = { userId: user._id.toString(), email: user.email, role: user.role };
    next();
};

module.exports = { authentication };
