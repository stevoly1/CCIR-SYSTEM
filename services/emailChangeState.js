const { EmailChange } = require('../models');

// Ends the account's change under way, if any. Its own module, so the password, retirement and
// email-change services can all use it without requiring one another.
const endActiveChanges = ({ userId, state, session, failedCode }) => EmailChange.updateMany(
  { user: userId, active: true },
  { $set: { state, endedAt: new Date(), ...(failedCode ? { failedCode } : {}) }, $unset: { active: 1 } },
  { session },
);

module.exports = { endActiveChanges };
