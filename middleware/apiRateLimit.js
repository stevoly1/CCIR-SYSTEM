const { rateLimit } = require('express-rate-limit');
const { TooManyRequestsError } = require('../errors');

const apiRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10000 : 100,
  validate: { xForwardedForHeader: false },
  // The shared error handler turns this into the standard 429 JSON envelope.
  handler: (req, res, next) => next(new TooManyRequestsError()),
};

const apiRateLimit = rateLimit(apiRateLimitOptions);

module.exports = { apiRateLimit, apiRateLimitOptions };
