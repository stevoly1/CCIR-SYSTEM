const { rateLimit } = require('express-rate-limit');
const { TooManyRequestsError } = require('../errors');

// Health probes are never limited: an orchestrator polling them must not be locked out.
const isHealthRequest = (req) => req.path === '/api/v1/health' || req.path.startsWith('/api/v1/health/');

const apiRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10000 : 100,
  validate: { xForwardedForHeader: false },
  skip: isHealthRequest,
  // The shared error handler turns this into the standard 429 JSON envelope.
  handler: (req, res, next) => next(new TooManyRequestsError()),
};

const apiRateLimit = rateLimit(apiRateLimitOptions);

module.exports = { apiRateLimit, apiRateLimitOptions, isHealthRequest };
