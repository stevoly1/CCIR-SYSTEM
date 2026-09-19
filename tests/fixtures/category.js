const Category = require('../../models/Category');

let sequence = 0;

const createCategoryFixture = (overrides = {}) => {
  sequence += 1;
  return Category.create({
    name: `Test Category ${sequence}`,
    description: 'Integration-test category fixture',
    defaultPriority: 'MEDIUM',
    isActive: true,
    ...overrides,
  });
};

module.exports = { createCategoryFixture };
