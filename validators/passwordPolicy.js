const { z } = require('zod');
const { BadRequestError } = require('../errors');

// Length only, no composition rules. Applies wherever a password is set (sign-up, reset, change);
// sign-in keeps accepting existing passwords, which may be 6 or 7 characters long.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

const newPasswordSchema = z.string()
    .min(PASSWORD_MIN_LENGTH, { message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long` })
    .max(PASSWORD_MAX_LENGTH, { message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters long` });

// The rule a schema cannot see on its own: the account's email address is not a password.
const assertPasswordAllowed = (password, { email }) => {
    if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
        throw new BadRequestError('Password must not be your email address', 'PASSWORD_REJECTED');
    }
};

module.exports = { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, newPasswordSchema, assertPasswordAllowed };
