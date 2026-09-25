const { StatusCodes } = require('http-status-codes');
const { User, RefreshToken } = require('../models');
const CustomError = require('../errors');
const { clearAttachedCookies } = require('../handlers/authHandler');
const {
    mutateAdministrator,
    mutateUserDetails,
    retireAccount,
} = require('../services/accountRetirementService');
const { verifyCurrentPassword } = require('../services/currentPasswordService');

const getProfile = async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) throw new CustomError.NotFoundError('User not found');
    res.status(StatusCodes.OK).json({ user });
};

const updateProfile = async (req, res) => {
    const user = await mutateUserDetails({
        targetUserId: req.user.userId,
        actorUserId: req.user.userId,
        changes: req.body,
        selfMutation: true,
    });

    res.status(StatusCodes.OK).json({ user });
};

const deleteProfile = async (req, res) => {
    const user = await User.findById(req.user.userId).select('+password');
    if (!user) throw new CustomError.NotFoundError('User not found');
    // A session alone is not enough to delete the account: the person confirms it.
    if (user.authProvider === 'google') {
        if (req.body?.confirmEmail !== user.email) {
            throw new CustomError.BadRequestError('Type your email address to confirm', 'CONFIRMATION_MISMATCH');
        }
    } else {
        if (!req.body?.password) {
            throw new CustomError.BadRequestError('Enter your password to delete your account', 'PASSWORD_REQUIRED');
        }
        await verifyCurrentPassword(user, req.body.password);
    }
    await retireAccount({
        targetUserId: req.user.userId,
        actorUserId: req.user.userId,
        reason: req.body?.reason,
    });
    clearAttachedCookies(res);
    res.status(StatusCodes.OK).json({ msg: 'Account deleted' });
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const listAllUsers = async (req, res) => {
    const { page, limit } = req.query;

    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.search) {
        const regex = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
        filter.$or = [{ name: regex }, { email: regex }];
    }

    const [users, total] = await Promise.all([
        User.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        User.countDocuments(filter),
    ]);

    res.status(StatusCodes.OK).json({
        users,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
};

const updateUser = async (req, res) => {
    const { reason, ...changes } = req.body;
    if (Object.hasOwn(changes, 'role') || Object.hasOwn(changes, 'isActive')) {
        const user = await mutateAdministrator({
            targetUserId: req.params.id,
            actorUserId: req.user.userId,
            changes,
            reason,
        });
        return res.status(StatusCodes.OK).json({ user });
    }

    const user = await mutateUserDetails({
        targetUserId: req.params.id,
        actorUserId: req.user.userId,
        changes,
    });

    res.status(StatusCodes.OK).json({ user });
};

const deleteUser = async (req, res) => {
    if (req.params.id === req.user.userId) {
        throw new CustomError.BadRequestError('Use your profile settings to delete your own account');
    }

    await retireAccount({
        targetUserId: req.params.id,
        actorUserId: req.user.userId,
        reason: req.body?.reason,
    });
    res.status(StatusCodes.OK).json({ msg: 'User retired' });
};

// Signs the user out everywhere, whether or not the request still carries the refresh cookie:
// access tokens are tied to these sessions, so they stop working at once too.
const logout = async (req, res) => {
    await RefreshToken.deleteMany({ user: req.user.userId });
    clearAttachedCookies(res);
    res.status(StatusCodes.OK).json({ msg: 'Logged out' });
};

// Assignment targets for administrators: active, non-retired agency users only, as
// contact-free identities, so the picker cannot offer a target the policy would reject.
const listAssignableUsers = async (req, res) => {
    const users = await User.find({ role: 'agency', isActive: true, retiredAt: null })
        .sort({ name: 1 })
        .limit(200)
        .select('name');
    res.status(StatusCodes.OK).json({
        users: users.map((user) => ({ userId: user._id, displayName: user.name })),
    });
};

module.exports = {
    listAssignableUsers,
    getProfile,
    updateProfile,
    deleteProfile,
    listAllUsers,
    updateUser,
    deleteUser,
    logout,
};
