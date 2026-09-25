const { z } = require('zod');
const { newPasswordSchema } = require('./passwordPolicy');

const emailSchema = z.string().trim().toLowerCase().email({ message: 'Invalid email address' }).max(254);
// Any string: a malformed link gets the same INVALID_OR_EXPIRED_TOKEN answer as an expired one.
const tokenSchema = z.string().min(1).max(100);
const currentPasswordSchema = z.string().min(1, { message: 'Enter your current password' }).max(128);

const forgotPasswordSchema = z.strictObject({ email: emailSchema });
const resetPasswordSchema = z.strictObject({ token: tokenSchema, password: newPasswordSchema });
const changePasswordSchema = z.strictObject({ currentPassword: currentPasswordSchema, newPassword: newPasswordSchema });
const requestOwnEmailChangeSchema = z.strictObject({ newEmail: emailSchema, currentPassword: currentPasswordSchema });
const requestEmailChangeSchema = z.strictObject({ newEmail: emailSchema });
const confirmEmailSchema = z.strictObject({ token: tokenSchema });
const deleteProfileSchema = z.strictObject({
  password: z.string().min(1).max(128).optional(),
  confirmEmail: z.string().trim().toLowerCase().max(254).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
// An unusable returnTo is ignored rather than refused, so any string passes here.
const googleRedirectQuerySchema = z.strictObject({ returnTo: z.string().optional() });

module.exports = {
  emailSchema,
  tokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  requestOwnEmailChangeSchema,
  requestEmailChangeSchema,
  confirmEmailSchema,
  deleteProfileSchema,
  googleRedirectQuerySchema,
};
