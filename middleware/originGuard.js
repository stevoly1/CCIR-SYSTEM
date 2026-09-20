const { ForbiddenError } = require('../errors');
const { getBrowserSecurityConfig } = require('../config/browserSecurity');

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const requireApprovedOrigin = (req, res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const { browserOrigin } = getBrowserSecurityConfig(process.env);
  if (req.get('origin') !== browserOrigin) {
    return next(new ForbiddenError('Request origin is not allowed'));
  }
  return next();
};

module.exports = requireApprovedOrigin;
