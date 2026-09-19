const parseDuration = require('../../utils/parseDuration');

describe('parseDuration', () => {
  it.each([
    ['15m', 15 * 60 * 1000],
    ['30d', 30 * 24 * 60 * 60 * 1000],
    ['1h', 60 * 60 * 1000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '15', 'm15', '1w', null, undefined])(
    'rejects invalid input %s',
    (input) => {
      expect(() => parseDuration(input)).toThrow('Invalid duration string');
    },
  );
});
