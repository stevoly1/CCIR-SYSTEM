const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { RefreshToken } = require('../models');
const parseDuration = require('../utils/parseDuration');

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

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('accessToken', accessToken, {
        httpOnly: true,
        expires: new Date(Date.now() + parseDuration(process.env.ACCESS_TOKEN_LIFESPAN)),
        secure: isProd,
        signed: true,
        sameSite: isProd ? 'none' : 'lax',
    });

    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        expires: new Date(Date.now() + parseDuration(process.env.REFRESH_TOKEN_LIFESPAN)),
        secure: isProd,
        signed: true,
        sameSite: isProd ? 'none' : 'lax',
    });
};

const clearAttachedCookies = (res) => {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
};

module.exports = {
    createAccessToken,
    createNewRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    attachCookiesToResponse,
    clearAttachedCookies,
};
