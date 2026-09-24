const crypto = require('node:crypto');
const pinoHttp = require('pino-http');
const { getLogger, serializeError } = require('../utils/logger');
const { isHealthRequest } = require('./apiRateLimit');

// Accepted from callers so a trace can cross services; anything else is replaced with a UUID.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;
const HEADER_ALLOWLIST = ['user-agent', 'content-type', 'content-length'];

const pathOf = (url = '') => String(url).split('?')[0];
const isHealth = (req) => isHealthRequest({ path: pathOf(req.originalUrl || req.url) });

const requestIdFor = (req) => {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
};

const withUserId = (req, value) => ({ ...value, ...(req.user?.userId ? { userId: String(req.user.userId) } : {}) });

// For any 5xx without an attached error, pino-http invents one ("failed with status code 500")
// whose stack is its own internals. The error handler has already logged the real error under
// the same requestId, so the invented one is dropped; a genuinely attached error is kept.
const withoutSyntheticError = (res, err, value) => {
  if (err?.message !== `failed with status code ${res.statusCode}`) return value;
  const { err: _synthetic, ...rest } = value;
  return rest;
};

const build = (logger) => pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = requestIdFor(req);
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customAttributeKeys: { reqId: 'requestId' },
  // req.log is then a lean child carrying only requestId, so handler lines stay small.
  quietReqLogger: true,
  customLogLevel: (req, res, err) => {
    if (isHealth(req)) return 'debug';
    if (err || res.statusCode >= 500) return 'error';
    return 'info';
  },
  // One line per request: the path without its query string, three harmless headers, and the
  // status code. Never the query, cookies, authorisation, other headers, client IP or body.
  serializers: {
    req: (req) => ({
      method: req.method,
      path: pathOf(req.url),
      headers: Object.fromEntries(HEADER_ALLOWLIST.filter((name) => req.headers?.[name]).map((name) => [name, req.headers[name]])),
    }),
    res: (res) => ({ statusCode: res.statusCode }),
    // pino-http wraps this around its own error serializer, so URL secrets are still scrubbed.
    err: serializeError,
  },
  customSuccessObject: (req, res, value) => withUserId(req, value),
  customErrorObject: (req, res, err, value) => withUserId(req, withoutSyntheticError(res, err, value)),
});

// Rebuilt only when the process logger changes (tests swap it), so production builds it once.
let cache = { logger: null, middleware: null };
const requestLogger = (req, res, next) => {
  const logger = getLogger();
  if (cache.logger !== logger) cache = { logger, middleware: build(logger) };
  return cache.middleware(req, res, next);
};

module.exports = { requestLogger, REQUEST_ID_PATTERN };
