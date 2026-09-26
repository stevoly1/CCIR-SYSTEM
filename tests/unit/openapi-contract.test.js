const request = require('supertest');
const SwaggerParser = require('@apidevtools/swagger-parser');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;
const { CONTRACT_PATH, getContract, listOperations } = require('../../utils/openapi');
const { testServer } = require('../helpers/testServer');

const EXPECTED_OPERATIONS = [
  'POST /auth/signup', 'POST /auth/login', 'GET /auth/google', 'GET /auth/google/callback',
  'POST /auth/password/forgot', 'POST /auth/password/reset', 'POST /auth/email/confirm', 'POST /auth/email/verify',
  'GET /users', 'GET /users/assignable', 'GET /users/profile', 'PATCH /users/profile', 'DELETE /users/profile', 'POST /users/profile/password', 'POST /users/profile/email', 'POST /users/profile/verification-email', 'POST /users/{id}/email', 'POST /users/logout', 'PATCH /users/{id}', 'DELETE /users/{id}',
  'GET /categories', 'POST /categories', 'GET /categories/{id}', 'PATCH /categories/{id}', 'DELETE /categories/{id}',
  'GET /complaints', 'POST /complaints', 'GET /complaints/{id}', 'PATCH /complaints/{id}', 'DELETE /complaints/{id}',
  'PATCH /complaints/{id}/status', 'PATCH /complaints/{id}/assign', 'POST /complaints/{id}/withdraw',
  'GET /admin/jobs', 'GET /admin/jobs/summary', 'POST /admin/jobs/{id}/retry', 'POST /admin/jobs/{id}/dismiss', 'POST /admin/jobs/retry-failed',
  'GET /location/autocomplete', 'GET /location/geocode', 'GET /health', 'GET /health/live', 'GET /health/ready', 'GET /openapi.json',
];

describe('OpenAPI contract', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const api = await SwaggerParser.validate(CONTRACT_PATH);
    expect(api.openapi).toMatch(/^3\.1\./);
    expect(api.info.version).toBe('2.0.0');
    expect(api.info.license).toMatchObject({ name: 'MIT', identifier: 'MIT' });
    expect(api.servers).toEqual([{ url: '/api/v1' }]);
  });

  it('documents exactly the routes the application mounts', () => {
    expect(listOperations().filter((op) => op !== 'GET /docs').sort()).toEqual([...EXPECTED_OPERATIONS].sort());
  });

  it('gives every operation at least one example, and every example matches its schema', async () => {
    const api = await SwaggerParser.dereference(CONTRACT_PATH);
    const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
    const problems = [];
    for (const [path, item] of Object.entries(api.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        let exampleCount = 0;
        for (const [status, response] of Object.entries(operation.responses)) {
          for (const [type, media] of Object.entries(response.content || {})) {
            const examples = media.example !== undefined ? [media.example] : Object.values(media.examples || {}).map((e) => e.value);
            exampleCount += examples.length;
            for (const example of examples) {
              if (!ajv.validate(media.schema, example)) problems.push(`${method.toUpperCase()} ${path} ${status} ${type}: ${ajv.errorsText()}`);
            }
          }
        }
        if (exampleCount === 0 && !Object.keys(operation.responses).every((s) => s.startsWith('3'))) problems.push(`${method.toUpperCase()} ${path}: no example`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('uses only synthetic example data', () => {
    const text = JSON.stringify(getContract());
    const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+/g) || [];
    expect(emails.filter((email) => !/@(example\.test|invalid\.local)$/.test(email))).toEqual([]);
  });

  it('is served as JSON at /api/v1/openapi.json', async () => {
    const response = await request(testServer()).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual(getContract());
  });
});
