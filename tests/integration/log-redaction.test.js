const path = require('node:path');
const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { captureLogs } = require('../helpers/captureLogs');
const { unsafeRequest, createAuthenticatedAgent } = require('../helpers/auth');
const { createCategoryFixture } = require('../fixtures/category');
const Category = require('../../models/Category');
const aiService = require('../../services/aiService');
const uploadService = require('../../services/uploadService');

// Distinctive values: if any of them reaches a log line, the test names it.
const SECRETS = {
  password: 'Redaction-Pass-9!',
  email: 'redaction.subject@example.test',
  oauthCode: 'OAUTHCODE-SECRET-123',
  oauthState: 'OAUTHSTATE-SECRET-456',
  apiKey: 'AIzaFAKE-LOG-KEY-789',
  dbPassword: 'Db-Pass-SECRET-321',
  publicId: 'ccir/complaints/pid-SECRET-654',
};

const imageFixture = path.join(__dirname, '..', 'fixtures', 'images', 'valid.jpg');

describe('log redaction across sensitive flows', () => {
  let logs;
  const cookieValues = [];
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  const assertNoSecrets = (extra = []) => {
    const text = logs.text();
    for (const value of [...Object.values(SECRETS), ...cookieValues, ...extra]) expect(text).not.toContain(value);
  };

  it('keeps sign-up, login, profile, and logout free of secrets', async () => {
    const agent = request.agent(testServer());
    await unsafeRequest(agent, 'post', '/api/v1/auth/signup').send({ name: 'Redaction Subject', email: SECRETS.email, password: SECRETS.password });
    const login = await unsafeRequest(agent, 'post', '/api/v1/auth/login').send({ email: SECRETS.email, password: SECRETS.password });
    expect(login.status).toBe(200);
    for (const cookie of login.headers['set-cookie'] || []) cookieValues.push(cookie.split(';')[0].split('=').slice(1).join('='));
    expect(cookieValues.length).toBeGreaterThan(0);
    await agent.get('/api/v1/users/profile');
    await unsafeRequest(agent, 'post', '/api/v1/users/logout').send({});
    expect(logs.lines.filter((line) => line.req).length).toBeGreaterThanOrEqual(4);
    assertNoSecrets(['Redaction Subject']);
  });

  it('keeps the Google callback code and state out of the logs', async () => {
    await request(testServer()).get(`/api/v1/auth/google/callback?code=${SECRETS.oauthCode}&state=${SECRETS.oauthState}`);
    expect(logs.lines.some((line) => line.req?.path === '/api/v1/auth/google/callback')).toBe(true);
    assertNoSecrets();
  });

  it('keeps a provider key in a failing AI request URL out of the logs', async () => {
    vi.stubEnv('GOOGLE_API_KEY', SECRETS.apiKey);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`request to https://generativelanguage.googleapis.com/x?key=${SECRETS.apiKey} failed`));
    await aiService.classifyComplaint({ description: 'Broken streetlight on the corner', categoryNames: ['Other'] });
    expect(logs.lines.some((line) => line.msg === 'AI classification failed; using the fallback')).toBe(true);
    assertNoSecrets();
  });

  it('keeps secrets in an unexpected error message out of the logs', async () => {
    const { agent } = await createAuthenticatedAgent();
    vi.spyOn(Category, 'find').mockImplementation(() => {
      throw new Error(`upstream https://svc.test/?api_key=${SECRETS.apiKey} via mongodb://ccir:${SECRETS.dbPassword}@db.internal/ccir`);
    });
    const response = await agent.get('/api/v1/categories');
    expect(response.status).toBe(500);
    expect(logs.lines.some((line) => line.msg === 'Unhandled error')).toBe(true);
    assertNoSecrets();
  });

  it('keeps the reporter and the stored image identifiers out of a photo submission', async () => {
    const { agent, user } = await createAuthenticatedAgent({ email: 'photo.reporter@example.test' });
    await createCategoryFixture({ name: 'Other' });
    vi.spyOn(aiService, 'classifyComplaint').mockResolvedValue({
      category: 'Other', priority: 'MEDIUM', summary: 'Road damage', tags: ['road'], confidence: 0.8, error: null,
    });
    vi.spyOn(uploadService, 'uploadComplaintImage').mockResolvedValue({
      url: `https://res.cloudinary.com/demo/image/upload/${SECRETS.publicId}.jpg`, publicId: SECRETS.publicId,
    });
    logs.lines.length = 0;

    const response = await unsafeRequest(agent, 'post', '/api/v1/complaints')
      .field('description', 'Deep pothole outside the school gate')
      .field('address', '1 Test Street')
      .attach('image', imageFixture);

    expect(response.status).toBe(201);
    expect(logs.lines.some((line) => line.req?.path === '/api/v1/complaints')).toBe(true);
    assertNoSecrets([user.email, 'Deep pothole', '1 Test Street']);
  });
});
