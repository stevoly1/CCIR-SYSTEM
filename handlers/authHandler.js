const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { RefreshToken } = require('../models');
const parseDuration = require('../utils/parseDuration');
const { getBrowserSecurityConfig } = require('../config/browserSecurity');

// `sid` names the session (the stored refresh-token record) the access token belongs to, so the
// token stops working as soon as that session is revoked (sign-out, suspension, role change).
const createAccessToken = ({ userId, sessionId }) => {
    return jwt.sign({ userId, sid: sessionId }, process.env.JWT_TOKEN, {
        expiresIn: process.env.ACCESS_TOKEN_LIFESPAN,
    });
};

const createRefreshTokenJwt = (payload) => {
    return jwt.sign(payload, process.env.JWT_REFRESH_TOKEN, {
        expiresIn: process.env.REFRESH_TOKEN_LIFESPAN,
    });
};

const verifyAccessToken = (token) => {
    return jwt.verify(token, process.env.JWT_TOKEN);
};

const verifyRefreshToken = (token) => {
    return jwt.verify(token, process.env.JWT_REFRESH_TOKEN);
};

const createNewRefreshToken = async ({ userId, session }) => {
    const refreshTokenString = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + parseDuration(process.env.REFRESH_TOKEN_LIFESPAN));

    const refreshToken = new RefreshToken({
        token: refreshTokenString,
        user: userId,
        expiresAt,
    });
    await refreshToken.save({ session });

    return createRefreshTokenJwt({ userId, refreshTokenString, sid: refreshToken._id.toString() });
};

// The session comes from the caller, or from the refresh token this server just signed.
const attachCookiesToResponse = ({ res, user, refreshToken, sessionId = jwt.decode(refreshToken)?.sid }) => {
    const accessToken = createAccessToken({ userId: user._id.toString(), sessionId });
    const { cookieOptions } = getBrowserSecurityConfig(process.env);

    res.cookie('accessToken', accessToken, {
        ...cookieOptions,
        expires: new Date(Date.now() + parseDuration(process.env.ACCESS_TOKEN_LIFESPAN)),
    });

    res.cookie('refreshToken', refreshToken, {
        ...cookieOptions,
        expires: new Date(Date.now() + parseDuration(process.env.REFRESH_TOKEN_LIFESPAN)),
    });
};

const clearCookieFromResponse = (res, name) => {
    const { cookieOptions } = getBrowserSecurityConfig(process.env);
    res.clearCookie(name, cookieOptions);
};

const clearAttachedCookies = (res) => {
    clearCookieFromResponse(res, 'accessToken');
    clearCookieFromResponse(res, 'refreshToken');
};

module.exports = {
    createAccessToken,
    createNewRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    attachCookiesToResponse,
    clearCookieFromResponse,
    clearAttachedCookies,
};
