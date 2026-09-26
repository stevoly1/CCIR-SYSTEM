const { captureLogs } = require('../helpers/captureLogs');
const { JobError } = require('../../services/jobs/jobError');

const ORIGINAL_API_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_EMAIL_FROM = process.env.EMAIL_FROM;

// The real Resend SDK runs against a stubbed fetch, so these tests prove how the service
// reads the SDK's { data, error } result, including errors the SDK returns without throwing.
const loadService = () => {
  vi.resetModules();
  delete require.cache[require.resolve('../../services/emailService')];
  return require('../../services/emailService');
};

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const filedMessage = { to: 'citizen@example.test', name: 'Ada', referenceCode: 'CCIR-00000001', complaintId: 'c1' };
const statusMessage = { ...filedMessage, status: 'WITHDRAWN', publicNote: null };

describe('email service', () => {
  let logs;
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_unit_fake_key';
    process.env.EMAIL_FROM = 'CCIR <noreply@example.test>';
    logs = captureLogs();
    // The SDK itself prints provider errors to the console outside production.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logs.restore();
    vi.unstubAllGlobals();
    if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
    if (ORIGINAL_EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = ORIGINAL_EMAIL_FROM;
  });

  it('labels a withdrawn report in words', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'email-2' }));
    vi.stubGlobal('fetch', fetchMock);
    const email = loadService();

    await expect(email.sendStatusUpdateEmail(statusMessage)).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).html).toContain('<strong>Withdrawn</strong>');
  });

});

describe('account emails', () => {
  let logs;
  const sent = [];
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_unit_fake_key';
    process.env.EMAIL_FROM = 'CCIR <noreply@example.test>';
    logs = captureLogs();
    sent.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return jsonResponse(200, { id: 'email-1' });
    }));
  });

  afterEach(() => {
    logs.restore();
    vi.unstubAllGlobals();
    if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
    if (ORIGINAL_EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = ORIGINAL_EMAIL_FROM;
  });

  const recipients = (message) => [message.to].flat();

  it.each([
    ['sendPasswordResetEmail', { to: 'ada@example.test', name: 'Ada', token: 'T0k3n_-x' }, '/reset-password#token=T0k3n_-x'],
    ['sendEmailChangeConfirmation', { to: 'new@example.test', name: 'Ada', token: 'T0k3n_-y' }, '/confirm-email#token=T0k3n_-y'],
    ['sendVerificationEmail', { to: 'ada@example.test', name: 'Ada', token: 'T0k3n_-z' }, '/verify-email#token=T0k3n_-z'],
  ])('%s links to the client page with the token after #', async (sender, args, pathAndFragment) => {
    const email = loadService();
    await expect(email[sender](args)).resolves.toBeUndefined();
    const [message] = sent;
    expect(recipients(message)).toEqual([args.to]);
    expect(message.html).toContain(`${process.env.ALLOWED_ORIGIN || ''}${pathAndFragment}`);
    expect(message.html).not.toMatch(/\?token=/);
  });

  it('asks a new account to verify its address', async () => {
    const email = loadService();
    await email.sendVerificationEmail({ to: 'ada@example.test', name: '<i>Ada</i>', token: 'abc' });
    expect(sent[0].subject).toBe('Verify your CCIR email address');
    expect(sent[0].html).toContain('&lt;i&gt;Ada&lt;/i&gt;');
    expect(sent[0].html).toContain('expires in 24 hours');
  });

  it('escapes the name', async () => {
    const email = loadService();
    await email.sendPasswordChangedEmail({ to: 'ada@example.test', name: '<b>Ada</b>' });
    expect(sent[0].html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
  });

  it('tells a Google account to sign in with Google, with no link', async () => {
    const email = loadService();
    await email.sendGoogleAccountNoticeEmail({ to: 'g@example.test', name: 'Gina' });
    expect(sent[0].html).toContain('Continue with Google');
    expect(sent[0].html).not.toContain('#token=');
  });

  it('masks the new address in the notice to the old one', async () => {
    const email = loadService();
    await email.sendEmailChangeNotice({ to: 'old@example.test', name: 'Ada', newEmail: 'jane.doe@example.com' });
    expect(recipients(sent[0])).toEqual(['old@example.test']);
    expect(sent[0].html).toContain('j•••@example.com');
    expect(sent[0].html).not.toContain('jane.doe@example.com');
  });

  it('tells the old address when an administrator asked for the change', async () => {
    const email = loadService();
    await email.sendEmailChangeNotice({ to: 'old@example.test', name: 'Ada', newEmail: 'jane.doe@example.com', requestedByAdministrator: true });
    expect(sent[0].html).toContain('An administrator asked to change');
    await email.sendEmailChangeNotice({ to: 'old@example.test', name: 'Ada', newEmail: 'jane.doe@example.com' });
    expect(sent[1].html).not.toContain('An administrator');
  });

  it('masks an address', () => {
    const email = loadService();
    expect(email.maskEmail('jane.doe@example.com')).toBe('j•••@example.com');
    expect(email.maskEmail('x@example.com')).toBe('x•••@example.com');
  });

});

describe('test outbox', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const modulePath = require.resolve('../../services/emailService');

  it('refuses to load with an outbox unless NODE_ENV is test', () => {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)})`], {
      env: { ...process.env, NODE_ENV: 'production', EMAIL_OUTBOX_DIR: os.tmpdir() },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('EMAIL_OUTBOX_DIR is for tests only');
  });

  it('writes each message as a JSON file instead of sending it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-outbox-'));
    vi.stubEnv('EMAIL_OUTBOX_DIR', dir);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const email = loadService();
      expect(await email.sendPasswordResetEmail({ to: 'ada@example.test', name: 'Ada', token: 'abc' })).toBeUndefined();
      const [file] = fs.readdirSync(dir);
      const message = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      expect(message).toMatchObject({ kind: 'password_reset', to: 'ada@example.test' });
      expect(message.links[0]).toMatch(/\/reset-password#token=abc$/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      delete require.cache[modulePath];
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('email transport', () => {
  let logs;
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_unit_fake_key';
    process.env.EMAIL_FROM = 'CCIR <noreply@example.test>';
    logs = captureLogs();
    // The SDK itself prints provider errors to the console outside production.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logs.restore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
    if (ORIGINAL_EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = ORIGINAL_EMAIL_FROM;
  });

  const failWith = (status, body, headers = {}) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  })));
  const failureOf = (email) => email.sendStatusUpdateEmail(statusMessage).then(() => null, (error) => error);

  it('passes the idempotency key to Resend and resolves on acceptance', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'email-1' }));
    vi.stubGlobal('fetch', fetch);
    const email = loadService();
    await expect(email.sendComplaintFiledEmail({ ...filedMessage, idempotencyKey: 'email-abc-0' })).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/emails$/);
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('email-abc-0');
    expect(JSON.parse(init.body)).toMatchObject({ to: 'citizen@example.test', from: 'CCIR <noreply@example.test>', subject: 'Your report CCIR-00000001 has been filed' });
  });

  it.each([
    [429, 'rate_limit_exceeded', 'RATE_LIMITED', true],
    [500, 'internal_server_error', 'PROVIDER_DOWN', true],
    [503, 'application_error', 'PROVIDER_DOWN', true],
    [409, 'concurrent_idempotent_requests', 'PROVIDER_DOWN', true],
    [409, 'invalid_idempotent_request', 'REJECTED', false],
    [422, 'validation_error', 'REJECTED', false],
    [403, 'validation_error', 'REJECTED', false],
    [401, 'missing_api_key', 'REJECTED', false],
  ])('turns a provider %s %s into %s', async (status, name, code, retryable) => {
    failWith(status, { name, message: 'provider text with citizen@example.test', statusCode: status });
    const failure = await failureOf(loadService());
    expect(failure).toBeInstanceOf(JobError);
    expect(failure).toMatchObject({ code, retryable, message: code });
    expect(logs.text()).not.toContain('citizen@example.test');
  });

  it('waits as long as Resend asks after a rate limit', async () => {
    failWith(429, { name: 'rate_limit_exceeded', message: 'Too many requests', statusCode: 429 }, { 'retry-after': '2' });
    expect(await failureOf(loadService())).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 2000 });
  });

  it('holds the queue for an hour when the daily or monthly sending quota is used up, and says so', async () => {
    failWith(429, { name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.', statusCode: 429 });
    expect(await failureOf(loadService())).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 60 * 60 * 1000 });
    expect(logs.lines).toContainEqual(expect.objectContaining({ event: 'email_quota_exceeded', quota: 'daily_quota_exceeded' }));
  });

  it('treats a network error, including one the SDK reports without throwing, or a hang as the provider being down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(loadService().sendPasswordChangedEmail({ to: 'a@example.test', name: 'A' })).rejects.toMatchObject({ code: 'PROVIDER_DOWN' });

    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const settled = loadService().sendPasswordChangedEmail({ to: 'a@example.test', name: 'A' }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await settled).toMatchObject({ code: 'PROVIDER_DOWN' });
  });

  it('says NOT_CONFIGURED without a key, without calling out, and logs that once', async () => {
    delete process.env.RESEND_API_KEY;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const email = loadService();
    await expect(email.sendPasswordChangedEmail({ to: 'a@example.test', name: 'A' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED', retryable: false });
    await expect(email.sendComplaintFiledEmail(filedMessage)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(logs.lines.filter((line) => line.event === 'email_not_configured')).toHaveLength(1);
    expect(logs.text()).not.toContain('a@example.test');
  });

  it('writes every kind to the test outbox, with its links and key', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-mail-'));
    vi.stubEnv('EMAIL_OUTBOX_DIR', dir);
    try {
      const email = loadService();
      await email.sendComplaintFiledEmail({ ...filedMessage, idempotencyKey: 'k1' });
      const [file] = fs.readdirSync(dir);
      expect(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))).toEqual({
        kind: 'report_filed', to: 'citizen@example.test', subject: 'Your report CCIR-00000001 has been filed',
        links: [expect.stringMatching(/\/dashboard\/reports\/c1$/)], idempotencyKey: 'k1',
      });
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets the transport be replaced (the journey server does)', async () => {
    const email = loadService();
    const send = vi.spyOn(email.emailTransport, 'send').mockResolvedValue(undefined);
    await email.sendPasswordChangedEmail({ to: 'a@example.test', name: 'A', idempotencyKey: 'k2' });
    await email.sendStatusUpdateEmail({ ...statusMessage, idempotencyKey: 'k3' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'password_changed', to: 'a@example.test', idempotencyKey: 'k2' }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'status_update', idempotencyKey: 'k3', links: [expect.stringMatching(/\/dashboard\/reports\/c1$/)] }));
  });
});
