const { createThrottleService } = require('../../services/authThrottleService');

const findDates = (value, output = []) => {
  if (value instanceof Date) output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => findDates(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => findDates(item, output));
  return output;
};

class MemoryThrottleModel {
  constructor() {
    this.documents = new Map();
  }

  async findOneAndUpdate(filter, pipeline) {
    const dates = [...new Map(findDates(pipeline).map((date) => [date.getTime(), date])).values()]
      .sort((left, right) => left - right);
    const [now, resetAt] = dates;
    const current = this.documents.get(filter._id);
    const next = !current || current.resetAt <= now
      ? { _id: filter._id, count: 1, resetAt }
      : { ...current, count: current.count + 1 };
    this.documents.set(filter._id, next);
    return { ...next };
  }

  async findById(id) {
    const value = this.documents.get(id);
    return value ? { ...value } : null;
  }

  async deleteOne(filter) {
    this.documents.delete(filter._id);
  }
}

describe('authentication throttle service', () => {
  it('requires a dedicated HMAC secret', () => {
    expect(() => createThrottleService({ model: new MemoryThrottleModel(), hmacSecret: '' }))
      .toThrow(/AUTH_THROTTLE_HMAC_SECRET/);
  });

  it('allows the fixed-window limit and denies the next attempt', async () => {
    const model = new MemoryThrottleModel();
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const service = createThrottleService({
      model,
      hmacSecret: 'unit-throttle-secret',
      now: () => new Date(clock.now),
    });

    for (let count = 1; count <= 5; count += 1) {
      await expect(service.consume('login-account', 'person@example.test', {
        limit: 5,
        windowMs: 15 * 60 * 1000,
      })).resolves.toMatchObject({ count });
    }
    await expect(service.consume('login-account', 'person@example.test', {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    })).rejects.toMatchObject({ statusCode: 429 });
  });

  it('atomically resets an expired window using the injected clock', async () => {
    const model = new MemoryThrottleModel();
    let now = new Date('2026-01-01T00:00:00.000Z');
    const service = createThrottleService({ model, hmacSecret: 'secret', now: () => new Date(now) });
    await service.consume('login-ip', '127.0.0.1', { limit: 20, windowMs: 1000 });
    await service.consume('login-ip', '127.0.0.1', { limit: 20, windowMs: 1000 });
    now = new Date('2026-01-01T00:00:01.001Z');

    await expect(service.consume('login-ip', '127.0.0.1', { limit: 20, windowMs: 1000 }))
      .resolves.toMatchObject({ count: 1, resetAt: new Date('2026-01-01T00:00:02.001Z') });
  });

  it('shares deterministic counters across service instances without storing raw subjects', async () => {
    const model = new MemoryThrottleModel();
    const first = createThrottleService({ model, hmacSecret: 'shared-secret' });
    const second = createThrottleService({ model, hmacSecret: 'shared-secret' });
    await first.consume('refresh-token', 'raw-refresh-token-secret', { limit: 10, windowMs: 1000 });
    const result = await second.consume('refresh-token', 'raw-refresh-token-secret', { limit: 10, windowMs: 1000 });

    expect(result.count).toBe(2);
    expect(JSON.stringify([...model.documents.entries()])).not.toContain('raw-refresh-token-secret');
    expect([...model.documents.keys()][0]).toMatch(/^refresh-token:[a-f0-9]{64}$/);
  });

  it('peeks and clears one scope without clearing an independent IP scope', async () => {
    const model = new MemoryThrottleModel();
    const service = createThrottleService({ model, hmacSecret: 'secret' });
    await service.consume('login-ip', '127.0.0.1', { limit: 20, windowMs: 1000 });
    await service.consume('login-account', 'person@example.test', { limit: 5, windowMs: 1000 });
    await service.clear('login-account', 'person@example.test');

    await expect(service.peek('login-account', 'person@example.test')).resolves.toMatchObject({ count: 0 });
    await expect(service.peek('login-ip', '127.0.0.1')).resolves.toMatchObject({ count: 1 });
  });
});
