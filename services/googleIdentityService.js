const mongoose = require('mongoose');
const { User } = require('../models');
const { createNewRefreshToken } = require('../handlers/authHandler');
const { validateGoogleProfile } = require('../policies/googleIdentityPolicy');
const {
  ensureAccountLifecycleGuard,
  touchAccountLifecycleGuard,
} = require('./accountLifecycleGuard');

class GoogleIdentityError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const requireActiveIdentity = (user) => {
  if (user.isActive !== true || user.retiredAt) {
    throw new GoogleIdentityError('INACTIVE_IDENTITY');
  }
};

const saveOrConflict = async (user, session) => {
  try {
    return await user.save({ session });
  } catch (error) {
    if (error.code === 11000) throw new GoogleIdentityError('IDENTITY_CONFLICT');
    throw error;
  }
};

const resolveGoogleIdentity = async (profile, session) => {
  const subjectOwner = await User.findOne({ googleId: profile.googleId }).session(session);

  if (subjectOwner) {
    requireActiveIdentity(subjectOwner);
    if (subjectOwner.email !== profile.email) {
      const emailOwner = await User.findOne({ email: profile.email }).session(session);
      if (emailOwner && String(emailOwner._id) !== String(subjectOwner._id)) {
        throw new GoogleIdentityError('IDENTITY_CONFLICT');
      }
      subjectOwner.email = profile.email;
      await saveOrConflict(subjectOwner, session);
    }
    return subjectOwner;
  }

  if (await User.exists({ email: profile.email }).session(session)) {
    throw new GoogleIdentityError('IDENTITY_CONFLICT');
  }

  const user = new User({
    name: profile.name,
    email: profile.email,
    googleId: profile.googleId,
    authProvider: 'google',
    avatarUrl: profile.avatarUrl,
  });
  return saveOrConflict(user, session);
};

const establishGoogleIdentitySession = async (rawProfile) => {
  const profile = validateGoogleProfile(rawProfile);
  await ensureAccountLifecycleGuard();
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      await touchAccountLifecycleGuard(session);
      const user = await resolveGoogleIdentity(profile, session);
      const refreshToken = await createNewRefreshToken({
        userId: user._id.toString(),
        session,
      });
      result = { user, refreshToken };
    });
  } finally {
    await session.endSession();
  }

  return result;
};

module.exports = { establishGoogleIdentitySession, GoogleIdentityError };
