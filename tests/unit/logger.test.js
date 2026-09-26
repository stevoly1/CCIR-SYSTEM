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

  // Personal data must not depend on each call site remembering to leave it out.
  it.each(['email', 'phone', 'phoneNumber', 'address'])('redacts the personal-data field %s', (key) => {
    getLogger().info({ [key]: 'personal-value-1', nested: { [key]: 'personal-value-1' } }, 'x');
    expect(logs.text()).not.toContain('personal-value-1');
  });

  // With no message, pino uses the error's own message as msg, which bypassed the scrubbing.
  it.each([
    ['an error alone', (error) => getLogger().error(error)],
    ['{ err } alone', (error) => getLogger().error({ err: error })],
    ['{ err } with an undefined message', (error) => getLogger().error({ err: error }, undefined)],
    ['an error-like plain object', (error) => getLogger().error({ err: { message: error.message } })],
  ])('scrubs the message taken from %s', (_label, log) => {
    log(new Error('connect failed for mongodb+srv://admin:S3cretPw@cluster.example.test/ccir?token=abc123'));
    expect(logs.text()).not.toContain('S3cretPw');
    expect(logs.text()).not.toContain('abc123');
    expect(logs.lines[0].msg).toContain('connect failed');
  });

  it.each(['Authorization', 'Cookie', 'set-cookie', 'Set-Cookie', 'x-api-key', 'X-Goog-Api-Key'])(
    'redacts the %s header whatever its case or punctuation',
    (header) => {
      getLogger().info({ req: { headers: { [header]: 'header-secret-value' } } }, 'x');
      expect(logs.text()).not.toContain('header-secret-value');
    },
  );

  // Key-based redaction used to rely on pino's wildcard paths, which throw on a top-level URL or
  // Buffer and stop at a fixed depth; the final line is now scrubbed instead.
  it('logs top-level URL and Buffer values without throwing, and scrubs the URL', () => {
    expect(() => getLogger().info({ link: new URL('https://example.test/cb?token=url-secret-1'), data: Buffer.from('ok') }, 'values')).not.toThrow();
    expect(logs.lines[0].msg).toBe('values');
    expect(logs.text()).not.toContain('url-secret-1');
  });

  it.each(['passwordHash', 'privateKey', 'jwt', 'name', 'fullName'])('redacts the %s field', (key) => {
    getLogger().info({ [key]: 'named-secret-1', nested: { [key]: 'named-secret-1' } }, 'x');
    expect(logs.text()).not.toContain('named-secret-1');
  });

  it('redacts secret-named fields at any depth', () => {
    getLogger().info({ a: { b: { c: { d: { e: { f: { password: 'deep-secret-1', note: 'kept' } } } } } } }, 'deep');
    expect(logs.text()).not.toContain('deep-secret-1');
    expect(logs.text()).toContain('kept');
  });

  it('redacts secret-named fields held inside class instances', () => {
    class Holder { constructor() { this.token = 'instance-secret-1'; this.label = 'kept'; } }
    getLogger().info({ holder: new Holder() }, 'instance');
    expect(logs.text()).not.toContain('instance-secret-1');
    expect(logs.text()).toContain('kept');
  });

  it('keeps an explicit msg field when an error is logged without a message argument', () => {
    getLogger().error({ err: new Error('raw detail'), msg: 'Upload step failed' });
    expect(logs.lines[0].msg).toBe('Upload step failed');
  });

  it('redacts secrets inside arrays of objects', () => {
    getLogger().info({ users: [{ role: 'agency', password: 'array-secret-value' }] }, 'x');
    expect(logs.text()).not.toContain('array-secret-value');
    expect(logs.lines[0].users[0].role).toBe('agency');
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

  it.each([
    ['mongodb+srv://ccir-app:S3cret-Pass@cluster0.example.net/ccir?retryWrites=true', 'mongodb+srv://[REDACTED]@cluster0.example.net/ccir?retryWrites=true'],
    ['connect mongodb://admin:hunter2@10.0.0.5:27017,10.0.0.6:27017/db failed', 'connect mongodb://[REDACTED]@10.0.0.5:27017,10.0.0.6:27017/db failed'],
    ['https://user:pw@proxy.example.test/path', 'https://[REDACTED]@proxy.example.test/path'],
  ])('scrubs credentials embedded in a connection string: %s', (input, expected) => {
    expect(scrubSecrets(input)).toBe(expected);
  });

  it('keeps a connection string without credentials unchanged', () => {
    expect(scrubSecrets('mongodb://db.example.net:27017/ccir')).toBe('mongodb://db.example.net:27017/ccir');
  });

  it('removes addresses from logged errors, and still hides connection-string credentials', () => {
    const err = new Error('E11000 duplicate key { email: "pat.o+x@mail.example.test" } via mongodb+srv://app:S3cret@cluster0.example.net/ccir');
    expect(serializeError(err).message).toBe('E11000 duplicate key { email: "[email]" } via mongodb+srv://[REDACTED]@cluster0.example.net/ccir');
    expect(serializeError(err).stack).not.toContain('pat.o+x@mail.example.test');
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
