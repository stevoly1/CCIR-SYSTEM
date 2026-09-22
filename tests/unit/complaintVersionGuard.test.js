const { assertExpectedVersion, versionFilter } = require('../../services/complaintVersionGuard');

describe('complaint version guard', () => {
  it('accepts an omitted or matching version', () => {
    expect(() => assertExpectedVersion({ __v: 4 }, undefined)).not.toThrow();
    expect(() => assertExpectedVersion({ __v: 4 }, 4)).not.toThrow();
  });

  it('rejects a mismatched version as STALE_COMPLAINT', () => {
    expect(() => assertExpectedVersion({ __v: 4 }, 3)).toThrow(expect.objectContaining({ code: 'STALE_COMPLAINT', statusCode: 409 }));
    expect(() => assertExpectedVersion({ __v: 4 }, 5)).toThrow(expect.objectContaining({ code: 'STALE_COMPLAINT' }));
  });

  it('filters on the stored version after checking the expected one', () => {
    expect(versionFilter({ __v: 4 }, undefined)).toBe(4);
    expect(versionFilter({ __v: 4 }, 4)).toBe(4);
    expect(() => versionFilter({ __v: 4 }, 2)).toThrow(expect.objectContaining({ code: 'STALE_COMPLAINT' }));
  });
});
