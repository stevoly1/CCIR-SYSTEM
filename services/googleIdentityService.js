const { User } = require('../models');
const { validateGoogleProfile } = require('../policies/googleIdentityPolicy');

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

const saveOrConflict = async (user) => {
  try {
    return await user.save();
  } catch (error) {
    if (error.code === 11000) throw new GoogleIdentityError('IDENTITY_CONFLICT');
    throw error;
  }
};

const resolveGoogleIdentity = async (rawProfile) => {
  const profile = validateGoogleProfile(rawProfile);
  const subjectOwner = await User.findOne({ googleId: profile.googleId });

  if (subjectOwner) {
    requireActiveIdentity(subjectOwner);
    if (subjectOwner.email !== profile.email) {
      const emailOwner = await User.findOne({ email: profile.email });
      if (emailOwner && String(emailOwner._id) !== String(subjectOwner._id)) {
        throw new GoogleIdentityError('IDENTITY_CONFLICT');
      }
      subjectOwner.email = profile.email;
      await saveOrConflict(subjectOwner);
    }
    return subjectOwner;
  }

  if (await User.exists({ email: profile.email })) {
    throw new GoogleIdentityError('IDENTITY_CONFLICT');
  }

  const user = new User({
    name: profile.name,
    email: profile.email,
    googleId: profile.googleId,
    authProvider: 'google',
    avatarUrl: profile.avatarUrl,
  });
  return saveOrConflict(user);
};

module.exports = { GoogleIdentityError, resolveGoogleIdentity };
