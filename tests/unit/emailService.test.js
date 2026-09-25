const { captureLogs } = require('../helpers/captureLogs');

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

  it.each([
    ['sendComplaintFiledEmail', filedMessage, 'report_filed'],
    ['sendStatusUpdateEmail', statusMessage, 'status_update'],
  ])('%s reports a provider error returned without throwing as a failed send', async (fn, message, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, {
      name: 'validation_error', message: 'Invalid `from` field.', statusCode: 422,
    })));
    const email = loadService();

    await expect(email[fn](message)).resolves.toBe(false);
    expect(logs.lines).toEqual([expect.objectContaining({
      level: 40, msg: 'Email not sent', provider: 'resend', kind, reason: 'validation_error', statusCode: 422,
    })]);
    expect(logs.text()).not.toContain('citizen@example.test');
    expect(logs.text()).not.toContain('Ada');
  });

  it.each([
    ['sendComplaintFiledEmail', filedMessage],
    ['sendStatusUpdateEmail', statusMessage],
  ])('%s reports a network failure as a failed send', async (fn, message) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const email = loadService();

    await expect(email[fn](message)).resolves.toBe(false);
    expect(logs.lines.map((line) => line.msg)).toEqual(['Email not sent']);
    expect(logs.text()).not.toContain('citizen@example.test');
  });

  it('reports a successful send and sends to the reporter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'email-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const email = loadService();

    await expect(email.sendComplaintFiledEmail(filedMessage)).resolves.toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/emails$/);
    expect(JSON.parse(options.body)).toMatchObject({ to: 'citizen@example.test', from: 'CCIR <noreply@example.test>' });
  });

  it('labels a withdrawn report in words', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'email-2' }));
    vi.stubGlobal('fetch', fetchMock);
    const email = loadService();

    await expect(email.sendStatusUpdateEmail(statusMessage)).resolves.toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).html).toContain('<strong>Withdrawn</strong>');
  });

  it('reports no send when email is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const email = loadService();

    await expect(email.sendComplaintFiledEmail(filedMessage)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
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
  ])('%s links to the client page with the token after #', async (sender, args, pathAndFragment) => {
    const email = loadService();
    await expect(email[sender](args)).resolves.toBe(true);
    const [message] = sent;
    expect(recipients(message)).toEqual([args.to]);
    expect(message.html).toContain(`${process.env.ALLOWED_ORIGIN || ''}${pathAndFragment}`);
    expect(message.html).not.toMatch(/\?token=/);
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

  it('masks an address', () => {
    const email = loadService();
    expect(email.maskEmail('jane.doe@example.com')).toBe('j•••@example.com');
    expect(email.maskEmail('x@example.com')).toBe('x•••@example.com');
  });

  it('reports a provider failure as a failed send without the recipient or the link in the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, { name: 'validation_error', message: 'bad', statusCode: 422 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const email = loadService();
    await expect(email.sendPasswordResetEmail({ to: 'ada@example.test', name: 'Ada', token: 'SECRET_TOKEN_1' })).resolves.toBe(false);
    const text = logs.text();
    expect(text).toContain('password_reset');
    expect(text).not.toContain('ada@example.test');
    expect(text).not.toContain('SECRET_TOKEN_1');
  });

  it('says it did not send when no provider is configured', async () => {
    delete process.env.RESEND_API_KEY;
    const email = loadService();
    await expect(email.sendEmailChangeConfirmation({ to: 'new@example.test', name: 'Ada', token: 't' })).resolves.toBe(false);
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
      expect(await email.sendPasswordResetEmail({ to: 'ada@example.test', name: 'Ada', token: 'abc' })).toBe(true);
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
