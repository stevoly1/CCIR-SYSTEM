const buildUserSnapshot = (user) => {
  if (!user) return null;

  return {
    userId: user.userId ?? user._id,
    displayName: user.displayName ?? user.name,
    role: user.role,
  };
};

const safeHistoricalIdentity = ({ populatedUser, snapshot }) => {
  const userId = populatedUser?._id ?? snapshot?.userId;
  const role = populatedUser?.role ?? snapshot?.role;
  let displayName;

  if (!populatedUser) {
    displayName = 'Unavailable account';
  } else if (populatedUser.retiredAt) {
    displayName = 'Retired account';
  } else {
    displayName = populatedUser.name;
  }

  return {
    userId,
    displayName,
    ...(role ? { role } : {}),
  };
};

module.exports = { buildUserSnapshot, safeHistoricalIdentity };
