const { checkClassification } = require('../../services/ai/outputCheck');
const { AiError, AI_ERROR_CODES } = require('../../services/ai/aiError');

const NAMES = ['Roads', 'Drainage', 'Other'];
const good = { category: 'Roads', priority: 'HIGH', summary: ' A pothole ', tags: ['Road', 'road', 'pothole'], confidence: 1.4 };

describe('classification output check', () => {
  it('accepts the exact object and returns normalized canonical output', () => {
    expect(checkClassification(JSON.stringify(good), NAMES)).toEqual({
      category: 'Roads', priority: 'HIGH', summary: 'A pothole', tags: ['road', 'pothole'], confidence: 1,
    });
    expect(checkClassification(JSON.stringify({ ...good, confidence: -2 }), NAMES).confidence).toBe(0);
    expect(checkClassification(JSON.stringify({ ...good, priority: 'CRITICAL', summary: '  Collapsed bridge blocks traffic  ', tags: [' Bridge ', 'DANGER', 'bridge'] }), NAMES))
      .toEqual({ category: 'Roads', priority: 'CRITICAL', summary: 'Collapsed bridge blocks traffic', tags: ['bridge', 'danger'], confidence: 1 });
  });

  it.each([
    ['not JSON', 'nope'],
    ['empty', ''],
    ['not a string', undefined],
    ['markdown fences', `\`\`\`json\n${JSON.stringify(good)}\n\`\`\``],
    ['an unknown category', JSON.stringify({ ...good, category: 'Parks' })],
    ['a missing field', JSON.stringify({ ...good, summary: undefined })],
    ['an extra field', JSON.stringify({ ...good, note: 'x' })],
    ['a bad priority', JSON.stringify({ ...good, priority: 'URGENT' })],
    ['too many tags', JSON.stringify({ ...good, tags: ['a', 'b', 'c', 'd', 'e', 'f'] })],
    ['an empty summary', JSON.stringify({ ...good, summary: '   ' })],
    ['a long summary', JSON.stringify({ ...good, summary: 's'.repeat(241) })],
    ['an empty tag', JSON.stringify({ ...good, tags: ['road', '   '] })],
    ['a long tag', JSON.stringify({ ...good, tags: ['x'.repeat(41)] })],
    ['non-array tags', JSON.stringify({ ...good, tags: 'road' })],
    ['non-numeric confidence', JSON.stringify({ ...good, confidence: '0.8' })],
    ['a non-finite confidence', '{"category":"Roads","priority":"HIGH","summary":"x","tags":[],"confidence":1e999}'],
  ])('refuses %s as INVALID_OUTPUT', (_, raw) => {
    expect(() => checkClassification(raw, NAMES)).toThrow(expect.objectContaining({ code: 'INVALID_OUTPUT' }));
    expect(() => checkClassification(raw, NAMES)).toThrow(AiError);
  });

  it('knows exactly the typed codes', () => {
    expect(AI_ERROR_CODES).toEqual(['TIMEOUT', 'RATE_LIMITED', 'PROVIDER_DOWN', 'AUTH', 'REFUSED', 'INVALID_OUTPUT', 'NOT_CONFIGURED']);
    expect(AiError.of('RATE_LIMITED', { retryAfterMs: 5000 })).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 5000, message: 'RATE_LIMITED' });
    expect(() => AiError.of('NOPE')).toThrow('Unknown AI error code');
  });
});
