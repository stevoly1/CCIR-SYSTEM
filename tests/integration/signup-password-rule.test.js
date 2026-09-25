const request = require('supertest');
const { testServer } = require('../helpers/testServer');
const { unsafeRequest } = require('../helpers/auth');
const { createUserFixture } = require('../fixtures/user');

const signup = (body) => unsafeRequest(request(testServer()), 'post', '/api/v1/auth/signup').send(body);

describe('sign-up password rule', () => {
  it('refuses a 7-character password', async () => {
    const response = await signup({ name: 'Short Pass', email: 'short@example.test', password: 'Seven-7' });
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('Password must be at least 8 characters long');
  });

  it('refuses the email address as the password', async () => {
    const response = await signup({ name: 'Same Pass', email: 'same@example.test', password: 'SAME@example.test' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PASSWORD_REJECTED');
  });

  it('accepts an 8-character password', async () => {
    const response = await signup({ name: 'Good Pass', email: 'good@example.test', password: 'Eight-88' });
    expect(response.status).toBe(201);
  });

  it('still signs in an existing account whose password has 6 characters', async () => {
    await createUserFixture({ email: 'old@example.test', password: 'abc123' });
    const response = await unsafeRequest(request(testServer()), 'post', '/api/v1/auth/login').send({ email: 'old@example.test', password: 'abc123' });
    expect(response.status).toBe(200);
  });
});
