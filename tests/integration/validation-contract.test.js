const mongoose = require('mongoose');
const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { Category } = require('../../models');
const complaintImageService = require('../../services/complaintImageService');
const CustomError = require('../../errors');
const { createAuthenticatedAgent, unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');

const missingId = '507f1f77bcf86cd799439011';

const expectError = (response, { status, code, path, message }) => {
  expect(response.status).toBe(status);
  expect(response.body).toEqual({
    error: {
      code,
      message: message || expect.any(String),
      ...(path ? {
        details: expect.arrayContaining([
          expect.objectContaining({ path }),
        ]),
      } : {}),
    },
    msg: message || expect.any(String),
  });
  expect(JSON.stringify(response.body)).not.toMatch(/stack|password|mongodb|provider body/i);
};

describe('canonical validation and error contract', () => {
  it.each([
    ['unknown login body field', async () => unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login')
      .send({ email: 'person@example.test', password: 'valid-password', role: 'admin' }), 'body.role'],
    ['invalid category id', async () => {
      const { agent } = await createAuthenticatedAgent();
      return agent.get('/api/v1/categories/not-an-object-id');
    }, 'params.id'],
    ['unknown list query', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get('/api/v1/users?secret=true');
    }, 'query.secret'],
    ['invalid role filter', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get('/api/v1/users?role=owner');
    }, 'query.role'],
    ['zero page', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get('/api/v1/users?page=0');
    }, 'query.page'],
    ['fractional page', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get('/api/v1/users?page=1.5');
    }, 'query.page'],
    ['non-numeric page', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get('/api/v1/users?page=first');
    }, 'query.page'],
    ['zero limit', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get('/api/v1/users?limit=0');
    }, 'query.limit'],
    ['limit above maximum', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get('/api/v1/users?limit=101');
    }, 'query.limit'],
    ['overlong search', async () => {
      const { agent } = await createAuthenticatedAgent({ role: 'admin' });
      return agent.get(`/api/v1/users?search=${'x'.repeat(201)}`);
    }, 'query.search'],
    ['invalid complaint sort', async () => {
      const { agent } = await createAuthenticatedAgent();
      return agent.get('/api/v1/complaints?sort=priority');
    }, 'query.sort'],
    ['invalid complaint status filter', async () => {
      const { agent } = await createAuthenticatedAgent();
      return agent.get('/api/v1/complaints?status=OPEN');
    }, 'query.status'],
    ['invalid complaint priority filter', async () => {
      const { agent } = await createAuthenticatedAgent();
      return agent.get('/api/v1/complaints?priority=URGENT');
    }, 'query.priority'],
    ['incomplete coordinate pair', async () => {
      const { agent } = await createAuthenticatedAgent();
      return agent.get('/api/v1/location/geocode?latitude=6.4');
    }, 'query.longitude'],
  ])('rejects %s before controller work', async (_label, invoke, path) => {
    const response = await invoke();
    expectError(response, { status: 400, code: 'VALIDATION_ERROR', path, message: 'Request validation failed' });
  });

  it('distinguishes a well-formed missing identifier from malformed input', async () => {
    const { agent } = await createAuthenticatedAgent();
    const response = await agent.get(`/api/v1/categories/${missingId}`);
    expectError(response, { status: 404, code: 'NOT_FOUND' });
  });

  it('maps malformed JSON without echoing parser input', async () => {
    const response = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":"person@example.test",');
    expectError(response, { status: 400, code: 'VALIDATION_ERROR', path: 'body', message: 'Request validation failed' });
  });

  it('maps duplicate-key errors without exposing key values', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const duplicate = Object.assign(new Error('E11000 duplicate private-slug'), {
      code: 11000,
      keyValue: { slug: 'private-slug' },
    });
    vi.spyOn(Category, 'create').mockRejectedValueOnce(duplicate);

    const response = await unsafeRequest(agent, 'post', '/api/v1/categories').send({ name: 'Roads' });
    expectError(response, { status: 409, code: 'CATEGORY_NAME_CONFLICT', message: 'A category with this name already exists' });
    expect(JSON.stringify(response.body)).not.toContain('private-slug');
  });

  it('uses the same conflict class for a duplicate found before persistence', async () => {
    const existing = await createUserFixture();
    const response = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/signup').send({
      name: 'Duplicate Person',
      email: existing.email,
      password: 'valid-password',
    });
    expectError(response, { status: 409, code: 'CONFLICT', message: 'An account with this email already exists' });
  });

  it('maps Mongoose validation and cast failures to safe validation details', async () => {
    const { agent } = await createAuthenticatedAgent({ role: 'admin' });
    const validation = new mongoose.Error.ValidationError();
    validation.addError('name', new mongoose.Error.ValidatorError({ path: 'name', message: 'private schema text' }));
    vi.spyOn(Category, 'create').mockRejectedValueOnce(validation);
    const validationResponse = await unsafeRequest(agent, 'post', '/api/v1/categories').send({ name: 'Roads' });
    expectError(validationResponse, { status: 400, code: 'VALIDATION_ERROR', path: 'body.name', message: 'Request validation failed' });

    vi.spyOn(Category, 'findById').mockRejectedValueOnce(
      new mongoose.Error.CastError('ObjectId', 'private-cast-value', '_id'),
    );
    const castResponse = await agent.get(`/api/v1/categories/${missingId}`);
    expectError(castResponse, { status: 400, code: 'VALIDATION_ERROR', path: 'params.id', message: 'Request validation failed' });
    expect(JSON.stringify(castResponse.body)).not.toMatch(/private/);
  });

  it.each([
    [new CustomError.PayloadTooLargeError('private upload path'), 413, 'PAYLOAD_TOO_LARGE'],
    [new CustomError.UnsupportedMediaTypeError('private decoder detail'), 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ])('maps file failures to stable safe errors', async (failure, status, code) => {
    const { agent } = await createAuthenticatedAgent();
    vi.spyOn(complaintImageService, 'prepareComplaintImages').mockRejectedValueOnce(failure);
    const response = await unsafeRequest(agent, 'post', '/api/v1/complaints')
      .send({ description: 'A sufficiently detailed complaint description', address: '1 Test Street' });
    expectError(response, { status, code });
    expect(JSON.stringify(response.body)).not.toMatch(/private/);
  });

  it('returns a stable throttling envelope', async () => {
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({
        email: 'rate-contract@example.test',
        password: 'valid-password',
      });
    }
    expectError(response, { status: 429, code: 'RATE_LIMITED' });
  });

  it('returns a generic envelope for unexpected failures', async () => {
    const { agent } = await createAuthenticatedAgent();
    vi.spyOn(Category, 'find').mockReturnValueOnce({
      sort: vi.fn().mockRejectedValueOnce(new Error('mongodb://user:password@private-host/provider body')),
    });
    const response = await agent.get('/api/v1/categories');
    expectError(response, { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });
});
