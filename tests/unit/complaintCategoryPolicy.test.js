const { chooseCategory } = require('../../policies/complaintCategoryPolicy');

const other = { _id: 'o', name: 'Other', defaultPriority: 'LOW' };
const roads = { _id: 'r', name: 'Roads', defaultPriority: 'HIGH' };
const active = [other, roads];
const ok = (category) => ({ category, priority: 'HIGH', error: null });

describe('chooseCategory', () => {
  it('uses Other on AI failure even with a hint', () => {
    expect(chooseCategory({ ai: { error: 'TIMEOUT', category: 'Other' }, activeCategories: active, hint: roads })).toBe(other);
  });

  it('prefers a valid hint on AI success', () => {
    expect(chooseCategory({ ai: ok('Other'), activeCategories: active, hint: roads })).toBe(roads);
  });

  it('matches the AI category case-insensitively, else Other', () => {
    expect(chooseCategory({ ai: ok('roads'), activeCategories: active })).toBe(roads);
    expect(chooseCategory({ ai: ok('Bridges'), activeCategories: active })).toBe(other);
    expect(chooseCategory({ ai: ok(undefined), activeCategories: active })).toBe(other);
  });

  it('fails when Other is not active', () => {
    expect(() => chooseCategory({ ai: ok('Roads'), activeCategories: [roads] })).toThrow('Active Other category is not configured');
  });
});
