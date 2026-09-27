// Provider text never travels with an AI failure: only these stable codes do.
const AI_ERROR_CODES = ['TIMEOUT', 'RATE_LIMITED', 'PROVIDER_DOWN', 'AUTH', 'REFUSED', 'INVALID_OUTPUT', 'NOT_CONFIGURED'];

class AiError extends Error {
  constructor(code, { retryAfterMs } = {}) {
    if (!AI_ERROR_CODES.includes(code)) throw new Error('Unknown AI error code');
    super(code);
    this.name = 'AiError';
    this.code = code;
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) this.retryAfterMs = retryAfterMs;
  }

  static of(code, options) { return new AiError(code, options); }
}

module.exports = { AiError, AI_ERROR_CODES };
