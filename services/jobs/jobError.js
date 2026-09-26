// The only failures a job reports. The message is the code, so a provider's text never travels.
const RETRYABLE = new Set(['PROVIDER_DOWN', 'RATE_LIMITED', 'TIMEOUT', 'INTERNAL']);

class JobError extends Error {
  constructor(code, { retryAfterMs } = {}) {
    super(code);
    this.name = 'JobError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) this.retryAfterMs = retryAfterMs;
    // Set by executeEntry: true when this was the last try.
    this.final = false;
  }

  static of(code, options) { return new JobError(code, options); }
}

const toJobError = (error) => (error instanceof JobError ? error : JobError.of('INTERNAL'));

module.exports = { JobError, RETRYABLE, toJobError };
