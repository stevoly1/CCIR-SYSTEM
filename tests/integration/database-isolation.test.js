const Category = require('../../models/Category');
const { createCategoryFixture } = require('../fixtures/category');

describe('integration database lifecycle', () => {
  it('persists data during a test', async () => {
    const category = await createCategoryFixture({ name: 'Roads' });

    expect(await Category.countDocuments()).toBe(1);
    expect(category.defaultPriority).toBe('MEDIUM');
  });

  it('starts the next test with empty collections', async () => {
    expect(await Category.countDocuments()).toBe(0);
  });
});
