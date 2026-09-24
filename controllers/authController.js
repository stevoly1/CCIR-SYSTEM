const crypto = require('crypto');
const { StatusCodes } = require('http-status-codes');
const { AuthThrottle, OAuthState, User } = require('../models');
const CustomError = require('../errors');
const {
    createNewRefreshToken,
    attachCookiesToResponse,
} = require('../handlers/authHandler');
const googleOAuthService = require('../services/googleOAuthService');
const { establishGoogleIdentitySession } = require('../services/googleIdentityService');
const { safeStateEqual } = require('../policies/googleIdentityPolicy');
const { getLogger } = require('../utils/logger');
const { getBrowserSecurityConfig } = require('../config/browserSecurity');
const { createThrottleService } = require('../services/authThrottleService');

const OAUTH_STATE_MAX_AGE_MS = 5 * 60 * 1000;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authThrottle = createThrottleService({
    model: AuthThrottle,
    hmacSecret: process.env.AUTH_THROTTLE_HMAC_SECRET,
});

const parseOAuthStateCookie = (value) => {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{13})\.([0-9a-f]{32})$/i);
    if (!match) return null;
    const issuedAt = Number(match[1]);
    const age = Date.now() - issuedAt;
    if (!Number.isSafeInteger(issuedAt) || age < 0 || age > OAUTH_STATE_MAX_AGE_MS) return null;
    return match[2];
};

const digestOAuthState = (state) => crypto.createHash('sha256').update(state).digest('hex');

const googleFailureRedirect = (res, frontendUrl, code) => {
    // res.req is the request (set by Express), so the line carries its requestId.
    (res.req?.log || getLogger()).warn({ reason: code }, 'Google sign-in failed');
    return res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
};

const signup = async (req, res) => {
    const { email, password, name, phone } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
        throw new CustomError.ConflictError('An account with this email already exists');
    }

    // role is intentionally never taken from the client — every signup is a citizen account.
    const user = await User.create({ email, password, name, phone });

    const refreshToken = await createNewRefreshToken({ userId: user._id.toString() });
    attachCookiesToResponse({ res, user, refreshToken });

    res.status(StatusCodes.CREATED).json({ user });
};

const login = async (req, res) => {
    const { email, password } = req.body;
    const accountSubject = email.trim().toLowerCase();

    await authThrottle.consume('login-ip', req.ip, { limit: 20, windowMs: AUTH_WINDOW_MS });
    const accountFailures = await authThrottle.peek('login-account', accountSubject);
    if (accountFailures.count >= 5) throw new CustomError.TooManyRequestsError();

    const user = await User.findOne({ email }).select('+password');
    if (
        !user
        || user.isActive !== true
        || user.retiredAt
        || !(await user.comparePassword(password))
    ) {
        await authThrottle.consume('login-account', accountSubject, {
            limit: 5,
            windowMs: AUTH_WINDOW_MS,
        });
        throw new CustomError.UnauthenticatedError('Invalid email or password');
    }

    const refreshToken = await createNewRefreshToken({ userId: user._id.toString() });
    await authThrottle.clear('login-account', accountSubject);
    attachCookiesToResponse({ res, user, refreshToken });

    user.password = undefined;
    res.status(StatusCodes.OK).json({ user });
};

const googleAuthRedirect = async (req, res) => {
    if (!googleOAuthService.isConfigured()) {
        throw new CustomError.CustomAPIError('Google sign-in is not configured', StatusCodes.SERVICE_UNAVAILABLE);
    }

    const state = crypto.randomBytes(16).toString('hex');
    const issuedAt = Date.now();
    await OAuthState.create({
        digest: digestOAuthState(state),
        expiresAt: new Date(issuedAt + OAUTH_STATE_MAX_AGE_MS),
    });
    const { cookieOptions } = getBrowserSecurityConfig(process.env);
    res.cookie('oauthState', `${issuedAt}.${state}`, {
        ...cookieOptions,
        maxAge: OAUTH_STATE_MAX_AGE_MS,
    });

    res.redirect(googleOAuthService.buildAuthUrl(state));
};

const googleAuthCallback = async (req, res) => {
    const { browserOrigin: frontendUrl, cookieOptions } = getBrowserSecurityConfig(process.env);
    const { code, state } = req.query;
    const expectedState = parseOAuthStateCookie(req.signedCookies.oauthState);
    res.clearCookie('oauthState', cookieOptions);

    if (typeof code !== 'string' || !code || !expectedState || !safeStateEqual(state, expectedState)) {
        return googleFailureRedirect(res, frontendUrl, 'STATE_INVALID');
    }

    const consumedState = await OAuthState.findOneAndDelete({
        digest: digestOAuthState(expectedState),
        expiresAt: { $gt: new Date() },
    });
    if (!consumedState) {
        return googleFailureRedirect(res, frontendUrl, 'STATE_INVALID');
    }

    let profile;
    try {
        profile = await googleOAuthService.exchangeCodeForProfile(code);
    } catch {
        return googleFailureRedirect(res, frontendUrl, 'PROVIDER_ERROR');
    }

    try {
        const { user, refreshToken } = await establishGoogleIdentitySession(profile);
        attachCookiesToResponse({ res, user, refreshToken });
        return res.redirect(`${frontendUrl}/dashboard`);
    } catch (error) {
        const stableCode = [
            'IDENTITY_CONFLICT',
            'INACTIVE_IDENTITY',
            'INVALID_PROFILE',
        ].includes(error.code) ? error.code : 'IDENTITY_ERROR';
        return googleFailureRedirect(res, frontendUrl, stableCode);
    }
};

module.exports = { signup, login, googleAuthRedirect, googleAuthCallback };
