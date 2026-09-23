const pino = require('pino');

// Field names whose values never reach a log line, at any depth up to MAX_DEPTH.
// `code` and `state` are deliberately absent: `code` is the application's error-code field,
// and OAuth code/state values only ever arrive in query strings, which are scrubbed below.
const SECRET_KEYS = ['password', 'newPassword', 'token', 'refreshToken', 'accessToken', 'apiKey', 'secret', 'cookie', 'cookies', 'authorization'];
const MAX_DEPTH = 4;
const REDACT_PATHS = SECRET_KEYS.flatMap((key) => Array.from({ length: MAX_DEPTH }, (_, depth) => `${'*.'.repeat(depth)}${key}`));

// Gemini puts its API key in the request URL, so URL secrets are scrubbed from any text we log.
const URL_SECRET = /([?&](?:key|api_key|apikey|token|access_token|signature|code|state)=)[^&\s"'#]+/gi;
const scrubSecrets = (text) => (typeof text === 'string' ? text.replace(URL_SECRET, '$1[REDACTED]') : text);

// Key matching that ignores case and punctuation, so header spellings such as `Authorization`,
// `set-cookie` or `X-Goog-Api-Key` are caught as well as the camelCase field names above.
const normaliseKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const SECRET_KEY_NAMES = new Set([...SECRET_KEYS, 'set-cookie'].map(normaliseKey));
const SECRET_KEY_SUFFIXES = ['password', 'token', 'secret', 'apikey'];
const isSecretKey = (key) => {
  const name = normaliseKey(key);
  return SECRET_KEY_NAMES.has(name) || SECRET_KEY_SUFFIXES.some((suffix) => name.endsWith(suffix));
};

// Copies plain objects and arrays with secret-named fields censored and every string scrubbed.
// Other objects (errors, dates, ObjectIds, buffers) pass through untouched; errors are handled
// by serializeError. The caller's object is never modified.
const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const scrubFields = (value, depth = 0) => {
  if (typeof value === 'string') return scrubSecrets(value);
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrubFields(item, depth + 1));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSecretKey(key) ? '[REDACTED]' : scrubFields(item, depth + 1),
  ]));
};

const serializeError = (err) => {
  if (!err || typeof err !== 'object') return err;
  return {
    type: err.name || 'Error',
    message: scrubSecrets(String(err.message ?? '')),
    ...(typeof err.code === 'string' || typeof err.code === 'number' ? { code: err.code } : {}),
    ...(err.stack ? { stack: scrubSecrets(err.stack) } : {}),
  };
};

const defaultLevel = () => process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

const createLogger = ({ destination, level = defaultLevel() } = {}) => pino({
  level,
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  serializers: { err: serializeError, error: serializeError },
  formatters: {
    log: (fields) => scrubFields(fields),
  },
  hooks: {
    logMethod(args, method) {
      return method.apply(this, args.map(scrubSecrets));
    },
  },
}, destination);

let current = createLogger();
const getLogger = () => current;
const useLogger = (logger) => {
  const previous = current;
  current = logger;
  return () => { current = previous; };
};

module.exports = { createLogger, getLogger, useLogger, scrubSecrets, serializeError, SECRET_KEYS };
