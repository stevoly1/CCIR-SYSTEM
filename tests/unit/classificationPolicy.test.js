const { decideClassification } = require('../../policies/classificationPolicy');

const roads = { _id: 'roads-id', name: 'Roads' };
const drainage = { _id: 'drain-id', name: 'Drainage' };
const other = { _id: 'other-id', name: 'Other' };
const categories = [roads, drainage, other];
const result = { category: 'Roads', priority: 'HIGH', summary: 'A pothole', tags: ['road'], confidence: 0.9, meta: { provider: 'kimi', model: 'kimi-test', promptVersion: 'classify-v1', durationMs: 5 } };
const now = new Date('2026-09-26T10:00:00Z');
const decide = (report, overrides = {}) => decideClassification({ report: { _id: 'c1', category: other._id, prioritySource: 'CATEGORY_DEFAULT', ...report }, requestSeq: 2, result, categories, inputMode: 'TEXT_ONLY', threshold: 0.7, now, ...overrides });

describe('what a classification changes', () => {
  it('writes only while the request is current and nobody changed the source meanwhile', () => {
    expect(decide({ categorySource: 'PENDING' }).filter).toEqual({ _id: 'c1', 'ai.requestSeq': 2, categorySource: 'PENDING', prioritySource: 'CATEGORY_DEFAULT' });
    expect(decide({ categorySource: undefined, prioritySource: undefined }).filter).toMatchObject({ categorySource: null, prioritySource: null });
  });

  it('always records the result, its provenance and DONE, and clears any failure', () => {
    const { update } = decide({ categorySource: 'PENDING' });
    expect(update.$set).toMatchObject({
      'ai.status': 'DONE', 'ai.suggestedCategory': 'Roads', 'ai.confidence': 0.9, 'ai.summary': 'A pothole', 'ai.tags': ['road'],
      'ai.classifiedAt': now, 'ai.provider': 'kimi', 'ai.model': 'kimi-test', 'ai.promptVersion': 'classify-v1', 'ai.inputMode': 'TEXT_ONLY',
    });
    expect(update.$unset).toMatchObject({ 'ai.failureCode': 1, 'ai.failedAt': 1, 'ai.error': 1 });
  });

  it.each(['PENDING', 'FALLBACK', 'AI', undefined])('lets the AI set the category when it came from %s', (categorySource) => {
    const { update } = decide({ categorySource });
    expect(update.$set).toMatchObject({ category: 'roads-id', categorySnapshot: { categoryId: 'roads-id', name: 'Roads' }, categorySource: 'AI' });
    expect(update.$unset).toMatchObject({ 'ai.disagreement': 1 });
  });

  it("keeps the citizen's category, and flags a confident disagreement", () => {
    const { update } = decide({ categorySource: 'CITIZEN', category: drainage._id });
    expect(update.$set.category).toBeUndefined();
    expect(update.$set['ai.disagreement']).toEqual({ categoryId: 'roads-id', name: 'Roads', confidence: 0.9 });
    expect(update.$unset['ai.disagreement']).toBeUndefined();
  });

  it('does not flag a disagreement below the threshold, or an agreement', () => {
    expect(decide({ categorySource: 'CITIZEN', category: drainage._id }, { threshold: 0.95 }).update.$set['ai.disagreement']).toBeUndefined();
    expect(decide({ categorySource: 'CITIZEN', category: roads._id }).update.$set['ai.disagreement']).toBeUndefined();
    expect(decide({ categorySource: 'CITIZEN', category: roads._id }).update.$unset['ai.disagreement']).toBe(1);
  });

  it('never changes a staff category, nor flags it', () => {
    const { update } = decide({ categorySource: 'STAFF', category: drainage._id });
    expect(update.$set.category).toBeUndefined();
    expect(update.$set.categorySource).toBeUndefined();
    expect(update.$set['ai.disagreement']).toBeUndefined();
    expect(update.$unset['ai.disagreement']).toBe(1);
  });

  it("sets the AI's priority unless staff set it", () => {
    expect(decide({ categorySource: 'PENDING' }).update.$set).toMatchObject({ priority: 'HIGH', prioritySource: 'AI' });
    const staff = decide({ categorySource: 'PENDING', prioritySource: 'STAFF' }).update.$set;
    expect(staff.priority).toBeUndefined();
    expect(staff.prioritySource).toBeUndefined();
  });

  it('falls back to Other if the named category is no longer among the active ones', () => {
    const { update } = decide({ categorySource: 'PENDING' }, { categories: [drainage, other] });
    expect(update.$set).toMatchObject({ category: 'other-id', categorySource: 'AI' });
  });

  it('fails explicitly when neither the AI category nor the required fallback is active', () => {
    expect(() => decide({ categorySource: 'PENDING' }, { categories: [drainage] }))
      .toThrow('Active Other category is not configured');
  });
});
