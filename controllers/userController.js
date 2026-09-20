const { StatusCodes } = require('http-status-codes');
const { User, RefreshToken } = require('../models');
const CustomError = require('../errors');
const { clearAttachedCookies } = require('../handlers/authHandler');
const { mutateAdministrator, retireAccount } = require('../services/accountRetirementService');

const getProfile = async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) throw new CustomError.NotFoundError('User not found');
    res.status(StatusCodes.OK).json({ user });
};

const updateProfile = async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) throw new CustomError.NotFoundError('User not found');

    const { email } = req.body;
    if (email && email !== user.email) {
        const existing = await User.findOne({ email });
        if (existing) throw new CustomError.BadRequestError('An account with this email already exists');
    }

    Object.assign(user, req.body);
    await user.save();

    res.status(StatusCodes.OK).json({ user });
};

const deleteProfile = async (req, res) => {
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
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

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
        });
        return res.status(StatusCodes.OK).json({ user });
    }

    const user = await User.findById(req.params.id);
    if (!user) throw new CustomError.NotFoundError('User not found');

    const { email } = req.body;
    if (email && email !== user.email) {
        const existing = await User.findOne({ email });
        if (existing) throw new CustomError.BadRequestError('An account with this email already exists');
    }

    Object.assign(user, changes);
    await user.save();

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

const logout = async (req, res) => {
    const refreshToken = req.signedCookies.refreshToken;
    if (refreshToken) {
        await RefreshToken.deleteMany({ user: req.user.userId });
    }
    clearAttachedCookies(res);
    res.status(StatusCodes.OK).json({ msg: 'Logged out' });
};

module.exports = {
    getProfile,
    updateProfile,
    deleteProfile,
    listAllUsers,
    updateUser,
    deleteUser,
    logout,
};
