const request = require('supertest');
const app = require('../../app');
const { createUserFixture } = require('../fixtures/user');

const unsafeRequest = (agent, method, path) => agent[method](path)
  .set('Origin', process.env.BROWSER_ORIGIN);

const createAuthenticatedAgent = async ({ role = 'citizen', isActive = true, ...overrides } = {}) => {
  const password = overrides.password || 'fixture-password';
  const user = await createUserFixture({ role, isActive, ...overrides, password });
  const agent = request.agent(app);
  const response = await unsafeRequest(agent, 'post', '/api/v1/auth/login')
    .send({ email: user.email, password });

  if (response.status !== 200) {
    throw new Error(`Fixture login failed with status ${response.status}`);
  }

  return { agent, user, password };
};

module.exports = { createAuthenticatedAgent, unsafeRequest };
