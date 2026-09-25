const { newPasswordSchema, assertPasswordAllowed } = require('../../validators/passwordPolicy');

describe('password rule', () => {
  it.each([
    ['7 characters', 'Seven-7', false],
    ['8 characters', 'Eight-88', true],
    ['128 characters', 'x'.repeat(128), true],
    ['129 characters', 'x'.repeat(129), false],
    ['no composition rules: 8 lowercase letters', 'abcdefgh', true],
  ])('%s', (_label, password, ok) => {
    expect(newPasswordSchema.safeParse(password).success).toBe(ok);
  });

  it('names the minimum in its message', () => {
    expect(newPasswordSchema.safeParse('short').error.issues[0].message).toBe('Password must be at least 8 characters long');
  });

  it('refuses the account email as the password, ignoring case and spaces', () => {
    expect(() => assertPasswordAllowed(' Ada@Example.test ', { email: 'ada@example.test' }))
      .toThrow(expect.objectContaining({ statusCode: 400, code: 'PASSWORD_REJECTED' }));
    expect(() => assertPasswordAllowed('a-different-pass', { email: 'ada@example.test' })).not.toThrow();
  });
});
