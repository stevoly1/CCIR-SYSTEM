const { safeReturnPath } = require('../../policies/returnPathPolicy');

describe('return path after Google sign-in', () => {
  it.each([
    '/dashboard',
    '/dashboard/reports/66f1a0c0a1b2c3d4e5f60001',
    '/dashboard/reports?status=PENDING',
  ])('accepts %s', (value) => expect(safeReturnPath(value)).toBe(value));

  it.each([
    ['another site', 'https://evil.example/dashboard'],
    ['protocol-relative', '//evil.example/dashboard'],
    ['backslash', '/\\evil.example'],
    ['double slash inside', '/dashboard//evil.example'],
    ['outside the dashboard', '/login'],
    ['look-alike prefix', '/dashboardx'],
    ['encoded slashes', '/dashboard/%2F%2Fevil.example'],
    ['dot segment', '/dashboard/../login'],
    ['encoded dot segment', '/dashboard/%2e%2e/login'],
    ['control character', '/dashboard\n/x'],
    ['over-long', `/dashboard/${'a'.repeat(600)}`],
    ['not a string', 42],
  ])('refuses %s', (_label, value) => expect(safeReturnPath(value)).toBeNull());
});
