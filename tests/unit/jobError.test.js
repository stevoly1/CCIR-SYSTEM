const { JobError, RETRYABLE, toJobError } = require('../../services/jobs/jobError');

describe('job errors', () => {
  it('retries passing failures only', () => {
    expect([...RETRYABLE].sort()).toEqual(['INTERNAL', 'PROVIDER_DOWN', 'RATE_LIMITED', 'TIMEOUT']);
    expect(JobError.of('PROVIDER_DOWN').retryable).toBe(true);
    for (const code of ['REJECTED', 'NOT_CONFIGURED', 'AUTH', 'REFUSED', 'INVALID_OUTPUT', 'RECIPIENT_CAPPED']) {
      expect(JobError.of(code).retryable).toBe(false);
    }
  });

  it('keeps the provider delay of a rate limit', () => {
    expect(JobError.of('RATE_LIMITED', { retryAfterMs: 5000 })).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 5000, message: 'RATE_LIMITED', final: false });
    expect(JobError.of('RATE_LIMITED', { retryAfterMs: -1 }).retryAfterMs).toBeUndefined();
  });

  it('turns an unexpected error into a retryable INTERNAL, without its message', () => {
    const converted = toJobError(new Error('secret detail'));
    expect(converted).toMatchObject({ code: 'INTERNAL', retryable: true, message: 'INTERNAL' });
    const original = JobError.of('REJECTED');
    expect(toJobError(original)).toBe(original);
  });
});
