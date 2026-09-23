const { normaliseCategoryName, cleanCategoryName, categorySlug } = require('../../utils/categoryName');

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

  it.each([
    ['Waste Accumulation', 'waste-accumulation'],
    ['  Street   Lights ', 'street-lights'],
    ['Roads & Bridges!', 'roads-bridges'],
  ])('derives the slug for %j', (input, slug) => {
    expect(categorySlug(input)).toBe(slug);
  });
});
