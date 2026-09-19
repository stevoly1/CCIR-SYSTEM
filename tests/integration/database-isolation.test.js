const Category = require('../../models/Category');

describe('integration database lifecycle', () => {
  it('persists data during a test', async () => {
    await Category.create({ name: 'Roads', defaultPriority: 'HIGH' });

    expect(await Category.countDocuments()).toBe(1);
  });

  it('starts the next test with empty collections', async () => {
    expect(await Category.countDocuments()).toBe(0);
  });
});
