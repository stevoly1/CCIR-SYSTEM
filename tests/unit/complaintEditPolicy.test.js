const policy = require('../../policies/complaintEditPolicy');

describe('complaint edit policy', () => {
  it('treats whitespace-only changes as immaterial and case as material', () => {
    expect(policy.isMaterialChange('Big pothole here', '  Big   pothole here ')).toBe(false);
    expect(policy.isMaterialChange('Big pothole here', 'big pothole here')).toBe(true);
    expect(policy.isMaterialChange('Big pothole here', 'Big pothole there')).toBe(true);
    expect(policy.isMaterialChange('Big pothole here', undefined)).toBe(false);
  });

  it('limits re-analyses and total edits', () => {
    const complaint = (analysisCount, edits) => ({ ai: { analysisCount }, editHistory: Array.from({ length: edits }) });
    expect(() => policy.assertEditAllowed({ complaint: complaint(5, 0), material: true })).not.toThrow();
    expect(() => policy.assertEditAllowed({ complaint: complaint(6, 0), material: true }))
      .toThrow(expect.objectContaining({ code: 'EDIT_LIMIT_REACHED' }));
    expect(() => policy.assertEditAllowed({ complaint: complaint(6, 0), material: false })).not.toThrow();
    expect(() => policy.assertEditAllowed({ complaint: complaint(1, 19), material: false })).not.toThrow();
    expect(() => policy.assertEditAllowed({ complaint: complaint(1, 20), material: false }))
      .toThrow(expect.objectContaining({ code: 'EDIT_LIMIT_REACHED' }));
  });

  it('treats a legacy complaint without an analysis count as analysed once', () => {
    expect(() => policy.assertEditAllowed({ complaint: { ai: {}, editHistory: [] }, material: true })).not.toThrow();
  });

  it('keeps staff priority and derives the rest', () => {
    const category = { defaultPriority: 'LOW' };
    expect(policy.reanalysisPriority({ complaint: { prioritySource: 'STAFF' }, ai: { priority: 'HIGH', error: null }, category })).toEqual({});
    expect(policy.reanalysisPriority({ complaint: { prioritySource: 'AI' }, ai: { priority: 'HIGH', error: null }, category }))
      .toEqual({ priority: 'HIGH', prioritySource: 'AI' });
    expect(policy.reanalysisPriority({ complaint: { prioritySource: 'CATEGORY_DEFAULT' }, ai: { priority: 'MEDIUM', error: 'TIMEOUT' }, category }))
      .toEqual({ priority: 'LOW', prioritySource: 'CATEGORY_DEFAULT' });
    expect(policy.reanalysisPriority({ complaint: {}, ai: { priority: 'HIGH', error: null }, category }))
      .toEqual({ priority: 'HIGH', prioritySource: 'AI' });
  });
});
