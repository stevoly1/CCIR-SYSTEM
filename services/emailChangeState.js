const { EmailChange } = require('../models');

// Ends the account's change under way, if any, and any change that failed: an administrator can
// retry a failed change (the Jobs page), so one the account has moved past must not stay failed.
// Its own module, so the password, retirement and email-change services can all use it without
// requiring one another.
const endOpenChanges = ({ userId, state, session }) => EmailChange.updateMany(
  { user: userId, $or: [{ active: true }, { state: 'FAILED' }] },
  { $set: { state, endedAt: new Date() }, $unset: { active: 1 } },
  { session },
);

module.exports = { endOpenChanges };
