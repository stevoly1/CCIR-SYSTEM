const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { RefreshToken } = require('../models');
const parseDuration = require('../utils/parseDuration');
const { getBrowserSecurityConfig } = require('../config/browserSecurity');

const createAccessToken = (payload) => {
    return jwt.sign(payload, process.env.JWT_TOKEN, {
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

const createNewRefreshToken = async ({ userId }) => {
    const refreshTokenString = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + parseDuration(process.env.REFRESH_TOKEN_LIFESPAN));

    await RefreshToken.create({
        token: refreshTokenString,
        user: userId,
        expiresAt,
    });

    return createRefreshTokenJwt({ userId, refreshTokenString });
};

const attachCookiesToResponse = ({ res, user, refreshToken }) => {
    const accessToken = createAccessToken({ userId: user._id.toString(), email: user.email, role: user.role });
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

const clearAttachedCookies = (res) => {
    const { cookieOptions } = getBrowserSecurityConfig(process.env);
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
};

module.exports = {
    createAccessToken,
    createNewRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    attachCookiesToResponse,
    clearAttachedCookies,
};
