const crypto = require('crypto');
const { StatusCodes } = require('http-status-codes');
const { User } = require('../models');
const CustomError = require('../errors');
const {
    createNewRefreshToken,
    attachCookiesToResponse,
} = require('../handlers/authHandler');
const googleOAuthService = require('../services/googleOAuthService');

const signup = async (req, res) => {
    const { email, password, name, phone } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
        throw new CustomError.BadRequestError('An account with this email already exists');
    }

    // role is intentionally never taken from the client — every signup is a citizen account.
    const user = await User.create({ email, password, name, phone });

    const refreshToken = await createNewRefreshToken({ userId: user._id.toString() });
    attachCookiesToResponse({ res, user, refreshToken });

    res.status(StatusCodes.CREATED).json({ user });
};

const login = async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
        throw new CustomError.UnauthenticatedError('Invalid email or password');
    }

    const refreshToken = await createNewRefreshToken({ userId: user._id.toString() });
    attachCookiesToResponse({ res, user, refreshToken });

    user.password = undefined;
    res.status(StatusCodes.OK).json({ user });
};

const googleAuthRedirect = (req, res) => {
    if (!googleOAuthService.isConfigured()) {
        throw new CustomError.CustomAPIError('Google sign-in is not configured', StatusCodes.SERVICE_UNAVAILABLE);
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauthState', state, {
        httpOnly: true,
        signed: true,
        maxAge: 5 * 60 * 1000,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
    });

    res.redirect(googleOAuthService.buildAuthUrl(state));
};

const googleAuthCallback = async (req, res) => {
    const frontendUrl = process.env.ALLOWED_ORIGIN || '/';
    const { code, state } = req.query;
    const expectedState = req.signedCookies.oauthState;
    res.clearCookie('oauthState');

    try {
        if (!code || !state || !expectedState || state !== expectedState) {
            throw new Error('Invalid or expired Google sign-in request');
        }

        const profile = await googleOAuthService.exchangeCodeForProfile(code);

        let user = await User.findOne({ $or: [{ googleId: profile.googleId }, { email: profile.email }] });

        if (!user) {
            user = await User.create({
                name: (profile.name || profile.email.split('@')[0]).slice(0, 60),
                email: profile.email,
                googleId: profile.googleId,
                authProvider: 'google',
                avatarUrl: profile.avatarUrl,
            });
        } else if (!user.googleId) {
            // Link an existing local account that shares this Google email.
            user.googleId = profile.googleId;
            user.avatarUrl = user.avatarUrl || profile.avatarUrl;
            await user.save();
        }

        const refreshToken = await createNewRefreshToken({ userId: user._id.toString() });
        attachCookiesToResponse({ res, user, refreshToken });

        res.redirect(`${frontendUrl}/dashboard`);
    } catch (error) {
        console.error('Google sign-in failed:', error.message);
        res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }
};

module.exports = { signup, login, googleAuthRedirect, googleAuthCallback };
