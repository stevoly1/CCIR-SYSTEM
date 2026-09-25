const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { TooManyRequestsError } = require('../errors');
const { verifyAccessToken } = require('../handlers/authHandler');

// Health probes are never limited: an orchestrator polling them must not be locked out.
const isHealthRequest = (req) => req.path === '/api/v1/health' || req.path.startsWith('/api/v1/health/');

// Requests per 15 minutes outside tests. A signed-in account is counted on its own, because many
// people can share one address (mobile carrier NAT, an office); a request without a validly signed,
// unexpired access token is counted by its address. The session behind the token is not checked here
// (that would cost a database read before the limit), so a signed-out token still counts against its
// own account. Everything from one address is also capped, whoever is signed in.
const API_RATE_LIMITS = Object.freeze({ perCaller: 300, perAddress: 3000 });
const TEST_LIMIT = 10000;

const apiRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? TEST_LIMIT : API_RATE_LIMITS.perAddress,
  validate: { xForwardedForHeader: false },
  skip: isHealthRequest,
  // The shared error handler turns this into the standard 429 JSON envelope.
  handler: (req, res, next) => next(new TooManyRequestsError()),
};

// The account a valid access token names. Only for counting: authentication still decides access.
const signedInAccount = (req) => {
  const token = req.signedCookies?.accessToken;
  if (!token) return null;
  try {
    const { userId } = verifyAccessToken(token);
    return typeof userId === 'string' ? userId : null;
  } catch {
    return null;
  }
};

const callerKey = (req) => {
  const account = signedInAccount(req);
  return account ? `account:${account}` : `address:${ipKeyGenerator(req.ip)}`;
};

// Needs cookie-parser to have run first (see app.js).
const createApiRateLimit = ({ perCaller, perAddress }) => {
  const addressLimit = rateLimit({ ...apiRateLimitOptions, limit: perAddress });
  const callerLimit = rateLimit({ ...apiRateLimitOptions, limit: perCaller, keyGenerator: callerKey });
  return (req, res, next) => addressLimit(req, res, (error) => (error ? next(error) : callerLimit(req, res, next)));
};

const apiRateLimit = createApiRateLimit(process.env.NODE_ENV === 'test'
  ? { perCaller: TEST_LIMIT, perAddress: TEST_LIMIT }
  : API_RATE_LIMITS);

module.exports = { apiRateLimit, apiRateLimitOptions, createApiRateLimit, API_RATE_LIMITS, isHealthRequest };
