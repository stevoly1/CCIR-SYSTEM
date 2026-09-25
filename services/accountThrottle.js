const { AuthThrottle } = require('../models');
const { createThrottleService } = require('./authThrottleService');

const AUTH_WINDOW_MS = 15 * 60 * 1000;
let throttle;

// One throttle for the account flows. It shares its store and HMAC key with sign-in, so the same
// scope and subject mean the same counter everywhere (for example 'login-account' and an email).
const accountThrottle = () => {
  throttle ??= createThrottleService({ model: AuthThrottle, hmacSecret: process.env.AUTH_THROTTLE_HMAC_SECRET });
  return throttle;
};

module.exports = { accountThrottle, AUTH_WINDOW_MS };
