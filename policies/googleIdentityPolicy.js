const crypto = require('crypto');
const { z } = require('zod');

const httpsUrl = z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:');
const profileSchema = z.object({
  googleId: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  emailVerified: z.literal(true),
  name: z.string().trim().min(2).max(60).optional(),
  avatarUrl: httpsUrl.optional(),
}).strict();

class GoogleIdentityPolicyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const validateGoogleProfile = (profile) => {
  const parsed = profileSchema.safeParse(profile);
  if (!parsed.success) throw new GoogleIdentityPolicyError('INVALID_PROFILE');
  const { googleId, email, name, avatarUrl } = parsed.data;
  return {
    googleId,
    email,
    name: name || 'Google user',
    avatarUrl,
  };
};

const safeStateEqual = (received, expected) => {
  if (
    typeof received !== 'string'
    || typeof expected !== 'string'
    || !/^[0-9a-f]{32}$/i.test(received)
    || !/^[0-9a-f]{32}$/i.test(expected)
  ) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
};

module.exports = {
  GoogleIdentityPolicyError,
  safeStateEqual,
  validateGoogleProfile,
};
