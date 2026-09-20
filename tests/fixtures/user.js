const User = require('../../models/User');

let sequence = 0;

const createUserFixture = (overrides = {}) => {
  sequence += 1;
  return User.create({
    name: `Test User ${sequence}`,
    email: `test-user-${sequence}@example.test`,
    password: 'fixture-password',
    phone: `+234000${String(sequence).padStart(6, '0')}`,
    role: 'citizen',
    isActive: true,
    ...overrides,
  });
};

module.exports = { createUserFixture };
