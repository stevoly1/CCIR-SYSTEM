const { createDatabaseProbe } = require('../../services/readinessService');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

describe('createDatabaseProbe', () => {
  let clock;
  const now = () => clock;
  beforeEach(() => { clock = 1_000_000; });

  it('shares one database check between concurrent calls', async () => {
    const pending = deferred();
    const check = vi.fn(() => pending.promise);
    const probe = createDatabaseProbe({ check, env: {}, now });
    const calls = Array.from({ length: 20 }, () => probe());
    pending.resolve({ status: 'ok' });
    const results = await Promise.all(calls);
    expect(check).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === 'ok')).toBe(true);
  });

  it('reuses the result for READINESS_CACHE_MS, defaulting to one second, then checks again', async () => {
    const check = vi.fn(async () => ({ status: 'ok' }));
    const probe = createDatabaseProbe({ check, env: {}, now });
    await probe();
    clock += 999;
    await probe();
    expect(check).toHaveBeenCalledTimes(1);
    clock += 1;
    await probe();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('also reuses an unavailable result, so an outage cannot be turned into a query storm', async () => {
    const check = vi.fn(async () => ({ status: 'unavailable', reason: 'DATABASE_TIMEOUT' }));
    const probe = createDatabaseProbe({ check, env: { READINESS_CACHE_MS: '5000' }, now });
    await probe();
    clock += 4000;
    expect(await probe()).toEqual({ status: 'unavailable', reason: 'DATABASE_TIMEOUT' });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('checks on every call when READINESS_CACHE_MS is 0', async () => {
    const check = vi.fn(async () => ({ status: 'ok' }));
    const probe = createDatabaseProbe({ check, env: { READINESS_CACHE_MS: '0' }, now });
    await probe();
    await probe();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('falls back to one second for an invalid READINESS_CACHE_MS', async () => {
    const check = vi.fn(async () => ({ status: 'ok' }));
    const probe = createDatabaseProbe({ check, env: { READINESS_CACHE_MS: 'soon' }, now });
    await probe();
    clock += 500;
    await probe();
    expect(check).toHaveBeenCalledTimes(1);
  });
});
