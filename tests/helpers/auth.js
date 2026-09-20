const request = require('supertest');
const app = require('../../app');
const { createUserFixture } = require('../fixtures/user');

const createAuthenticatedAgent = async ({ role = 'citizen', isActive = true, ...overrides } = {}) => {
  const password = overrides.password || 'fixture-password';
  const user = await createUserFixture({ role, isActive, ...overrides, password });
  const agent = request.agent(app);
  const response = await agent.post('/api/v1/auth/login').send({ email: user.email, password });

  if (response.status !== 200) {
    throw new Error(`Fixture login failed with status ${response.status}`);
  }

  return { agent, user, password };
};

module.exports = { createAuthenticatedAgent };
