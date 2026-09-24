const { signupSchema, updateProfileSchema, adminUpdateUserSchema } = require('../../validators/userValidator');

const PHONE_MESSAGE = 'Enter a valid phone number: 7 to 15 digits, optionally starting with +';

describe('phone numbers on accounts', () => {
  const schemas = [['signup', signupSchema, { email: 'a@example.test', password: 'secret-1', name: 'Ada' }], ['profile', updateProfileSchema, {}], ['admin edit', adminUpdateUserSchema, {}]];

  it.each(schemas)('%s accepts common written forms and an empty value that clears it', (_, schema, base) => {
    for (const phone of ['+2348012345678', '0801 234 5678', '(01) 234-5678', '+44 20 7946 0958', '']) {
      expect(schema.safeParse({ ...base, phone }).success).toBe(true);
    }
  });

  it.each(schemas)('%s refuses text, too few or too many digits, and a misplaced +', (_, schema, base) => {
    for (const phone of ['call me maybe', '12345', '1234567890123456', '0801+2345678', '+234-801-abc-5678']) {
      const result = schema.safeParse({ ...base, phone });
      expect(result.success).toBe(false);
      expect(result.error.issues.map((issue) => issue.message)).toContain(PHONE_MESSAGE);
    }
  });
});

describe('names in the administrator edit', () => {
  it('explains a name that is too short or too long in words', () => {
    expect(adminUpdateUserSchema.safeParse({ name: 'A' }).error.issues[0].message).toBe('Name must be at least 2 characters long');
    expect(adminUpdateUserSchema.safeParse({ name: 'A'.repeat(61) }).error.issues[0].message).toBe('Name must be at most 60 characters long');
  });
});
