const { TooManyRequestsError } = require('../errors');
const { wrongPassword } = require('../errors/domainErrors');
const { secondsUntil } = require('./authThrottleService');
const { accountThrottle, AUTH_WINDOW_MS } = require('./accountThrottle');

// A session is not proof of the password. Wrong answers count against the sign-in lockout for the
// account, so a stolen session cannot be used to guess it.
const verifyCurrentPassword = async (user, password) => {
  const subject = user.email;
  const failures = await accountThrottle().peek('login-account', subject);
  if (failures.count >= 5) {
    throw new TooManyRequestsError(undefined, { retryAfterSeconds: secondsUntil(failures.resetAt, new Date()) });
  }
  if (typeof password !== 'string' || !(await user.comparePassword(password))) {
    await accountThrottle().consume('login-account', subject, { limit: 5, windowMs: AUTH_WINDOW_MS });
    throw wrongPassword();
  }
};

module.exports = { verifyCurrentPassword };
