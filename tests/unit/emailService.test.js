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
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_unit_fake_key';
    process.env.EMAIL_FROM = 'CCIR <noreply@example.test>';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
    if (ORIGINAL_EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = ORIGINAL_EMAIL_FROM;
  });

  it.each([
    ['sendComplaintFiledEmail', filedMessage, 'Failed to send report filed email:'],
    ['sendStatusUpdateEmail', statusMessage, 'Failed to send status update email:'],
  ])('%s reports a provider error returned without throwing as a failed send', async (fn, message, logLine) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, {
      name: 'validation_error', message: 'Invalid `from` field.', statusCode: 422,
    })));
    const email = loadService();

    await expect(email[fn](message)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(logLine, 'validation_error');
  });

  it.each([
    ['sendComplaintFiledEmail', filedMessage],
    ['sendStatusUpdateEmail', statusMessage],
  ])('%s reports a network failure as a failed send', async (fn, message) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const email = loadService();

    await expect(email[fn](message)).resolves.toBe(false);
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
