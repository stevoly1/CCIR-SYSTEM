const buildUserSnapshot = (user) => {
  if (!user) return null;

  return {
    userId: user.userId ?? user._id,
    displayName: user.displayName ?? user.name,
    role: user.role,
  };
};

module.exports = { buildUserSnapshot };
