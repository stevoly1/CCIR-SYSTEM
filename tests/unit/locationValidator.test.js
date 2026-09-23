const { locationObjectSchema, buildLocation } = require('../../validators/locationValidator');

const parse = (value) => locationObjectSchema.safeParse(value);

describe('location contract', () => {
  it.each([
    [{ address: '12 Market Road' }],
    [{ address: '12 Market Road', latitude: 6.6, longitude: 3.3, coordinateSource: 'DEVICE' }],
    [{ address: '12 Market Road', latitude: '6.6', longitude: '3.3', coordinateSource: 'SUGGESTION' }],
    [{ address: 'Equator crossing', latitude: 0, longitude: 32.5, coordinateSource: 'DEVICE' }],
  ])('accepts %j', (value) => {
    expect(parse(value).success).toBe(true);
  });

  it.each([
    ['missing address', { latitude: 6.6, longitude: 3.3, coordinateSource: 'DEVICE' }, 'address'],
    ['short address', { address: 'ab' }, 'address'],
    ['blank address', { address: '     ' }, 'address'],
    ['overlong address', { address: 'x'.repeat(501) }, 'address'],
    ['lone latitude', { address: '12 Market Road', latitude: 6.6, coordinateSource: 'DEVICE' }, 'longitude'],
    ['null island', { address: '12 Market Road', latitude: 0, longitude: 0, coordinateSource: 'DEVICE' }, 'latitude'],
    ['pair without source', { address: '12 Market Road', latitude: 6.6, longitude: 3.3 }, 'coordinateSource'],
    ['source without pair', { address: '12 Market Road', coordinateSource: 'DEVICE' }, 'coordinateSource'],
    ['unknown source', { address: '12 Market Road', latitude: 6.6, longitude: 3.3, coordinateSource: 'IP' }, 'coordinateSource'],
    ['out of range', { address: '12 Market Road', latitude: 91, longitude: 3.3, coordinateSource: 'DEVICE' }, 'latitude'],
    ['non-numeric', { address: '12 Market Road', latitude: 'north', longitude: 3.3, coordinateSource: 'DEVICE' }, 'latitude'],
    // z.coerce.number would turn these into 0 or 1 and store a fabricated position.
    ['null latitude', { address: '12 Market Road', latitude: null, longitude: 3.3, coordinateSource: 'DEVICE' }, 'latitude'],
    ['empty-string latitude', { address: '12 Market Road', latitude: '', longitude: 3.3, coordinateSource: 'DEVICE' }, 'latitude'],
    ['blank-string latitude', { address: '12 Market Road', latitude: '  ', longitude: 3.3, coordinateSource: 'DEVICE' }, 'latitude'],
    ['boolean latitude', { address: '12 Market Road', latitude: true, longitude: 3.3, coordinateSource: 'DEVICE' }, 'latitude'],
    ['array latitude', { address: '12 Market Road', latitude: [6.6], longitude: 3.3, coordinateSource: 'DEVICE' }, 'latitude'],
    ['unknown field', { address: '12 Market Road', city: 'Ikeja' }, undefined],
  ])('rejects %s', (_label, value, field) => {
    const result = parse(value);
    expect(result.success).toBe(false);
    if (field) expect(result.error.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it('trims the address', () => {
    expect(parse({ address: '  12 Market Road  ' }).data.address).toBe('12 Market Road');
  });

  it('builds a stored location without empty coordinate keys', () => {
    expect(buildLocation({ address: 'A road' })).toEqual({ address: 'A road' });
    expect(buildLocation({ address: 'A road', latitude: 1, longitude: 2, coordinateSource: 'DEVICE' }))
      .toEqual({ address: 'A road', latitude: 1, longitude: 2, coordinateSource: 'DEVICE' });
  });
});
