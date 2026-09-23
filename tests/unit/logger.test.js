const { captureLogs } = require('../helpers/captureLogs');
const { getLogger, scrubSecrets, serializeError, SECRET_KEYS } = require('../../utils/logger');

describe('logger', () => {
  let logs;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  it('writes JSON lines with level, time and message, and no pid or hostname', () => {
    getLogger().info('hello');
    expect(logs.lines[0]).toMatchObject({ level: 30, msg: 'hello' });
    expect(logs.lines[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(logs.lines[0]).not.toHaveProperty('pid');
    expect(logs.lines[0]).not.toHaveProperty('hostname');
  });

  it.each(SECRET_KEYS)('redacts %s at the top level and when nested', (key) => {
    getLogger().info({ [key]: 'top-secret-value', nested: { [key]: 'top-secret-value', deeper: { [key]: 'top-secret-value' } } }, 'x');
    expect(logs.text()).not.toContain('top-secret-value');
    expect(logs.text()).toContain('[REDACTED]');
  });

  it.each(['Authorization', 'Cookie', 'set-cookie', 'Set-Cookie', 'x-api-key', 'X-Goog-Api-Key'])(
    'redacts the %s header whatever its case or punctuation',
    (header) => {
      getLogger().info({ req: { headers: { [header]: 'header-secret-value' } } }, 'x');
      expect(logs.text()).not.toContain('header-secret-value');
    },
  );

  it('redacts secrets inside arrays of objects', () => {
    getLogger().info({ users: [{ email: 'a@example.test', password: 'array-secret-value' }] }, 'x');
    expect(logs.text()).not.toContain('array-secret-value');
    expect(logs.lines[0].users[0].email).toBe('a@example.test');
  });

  it('does not change the object it was given', () => {
    const fields = { password: 'kept-for-caller', url: '/a?key=kept-too' };
    getLogger().info(fields, 'x');
    expect(fields).toEqual({ password: 'kept-for-caller', url: '/a?key=kept-too' });
  });

  it('keeps the application error code field', () => {
    getLogger().info({ code: 'VALIDATION_ERROR' }, 'rejected');
    expect(logs.lines[0].code).toBe('VALIDATION_ERROR');
  });

  it('scrubs secrets in URLs inside messages', () => {
    getLogger().error('request to https://x.test/v1?alt=json&key=AIzaFAKE123 failed');
    expect(logs.text()).not.toContain('AIzaFAKE123');
    expect(logs.lines[0].msg).toContain('key=[REDACTED]');
  });

  it('scrubs secrets in URLs inside structured fields, including nested ones', () => {
    getLogger().warn({ url: 'https://x.test/a?key=AIzaFAKE456', upstream: { href: '/b?token=tok-FAKE789' } }, 'upstream call');
    expect(logs.text()).not.toContain('AIzaFAKE456');
    expect(logs.text()).not.toContain('tok-FAKE789');
    expect(logs.lines[0].url).toBe('https://x.test/a?key=[REDACTED]');
  });

  it('serialises errors without leaking URL secrets from message or stack', () => {
    const err = new Error('fetch https://g.test/m?key=AIzaFAKE999 failed');
    getLogger().error({ err }, 'boom');
    expect(logs.lines[0].err).toMatchObject({ type: 'Error' });
    expect(logs.lines[0].err.stack).toContain('key=[REDACTED]');
    expect(logs.text()).not.toContain('AIzaFAKE999');
  });

  it('scrubs the known query-string secret names', () => {
    expect(scrubSecrets('a?token=abc&signature=def&api_key=ghi&access_token=jkl'))
      .toBe('a?token=[REDACTED]&signature=[REDACTED]&api_key=[REDACTED]&access_token=[REDACTED]');
  });

  it('serialises non-error values unchanged', () => {
    expect(serializeError('plain')).toBe('plain');
  });

  it('is silent by default under NODE_ENV=test', () => {
    logs.restore();
    const { createLogger } = require('../../utils/logger');
    expect(createLogger().level).toBe(process.env.LOG_LEVEL || 'silent');
    logs = captureLogs();
  });
});
