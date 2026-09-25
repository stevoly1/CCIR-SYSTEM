const { wrongPassword } = require('../errors/domainErrors');
const { accountThrottle, AUTH_WINDOW_MS } = require('./accountThrottle');

// A session is not proof of the password. Each answer counts against the sign-in lockout for the
// account before it is checked, so a stolen session cannot be used to guess it, even with many
// requests at once: past the fifth, the password is never compared. A right answer clears the
// count, as signing in does.
const verifyCurrentPassword = async (user, password) => {
  const subject = user.email;
  await accountThrottle().consume('login-account', subject, { limit: 5, windowMs: AUTH_WINDOW_MS });
  if (typeof password !== 'string' || !(await user.comparePassword(password))) throw wrongPassword();
  await accountThrottle().clear('login-account', subject);
};

module.exports = { verifyCurrentPassword };
