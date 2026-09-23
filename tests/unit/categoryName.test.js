const { normaliseCategoryName, cleanCategoryName } = require('../../utils/categoryName');

describe('category names', () => {
  it.each([
    ['Roads', 'roads'],
    ['  ROADS ', 'roads'],
    ['Street   Lights', 'street lights'],
    ['Street\tLights', 'street lights'],
  ])('normalises %j', (input, key) => {
    expect(normaliseCategoryName(input)).toBe(key);
  });

  it('cleans display names without changing case', () => {
    expect(cleanCategoryName('  Street   Lights ')).toBe('Street Lights');
  });
});
