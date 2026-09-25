const { RefreshToken } = require('../models');

// Every access token names its session, so deleting the records ends access at once.
const endSessions = ({ userId, exceptSessionId, session }) => RefreshToken.deleteMany({
  user: userId,
  ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}),
}, { session });

module.exports = { endSessions };
