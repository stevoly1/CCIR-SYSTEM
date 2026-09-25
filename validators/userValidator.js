const { z } = require('zod');
const {
    limitSchema,
    pageSchema,
    searchSchema,
} = require('./commonValidator');

const roleSchema = z.enum(['citizen', 'admin', 'agency']);

// Written forms people actually use (+234 801 234 5678, (01) 234-5678); an empty value clears it.
const PHONE_MESSAGE = 'Enter a valid phone number: 7 to 15 digits, optionally starting with +';
const isPhoneNumber = (value) => {
    if (value === '') return true;
    if (!/^\+?[0-9 ().-]+$/.test(value)) return false;
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
};
const phoneSchema = z.string().trim().max(30, { message: PHONE_MESSAGE })
    .refine(isPhoneNumber, { message: PHONE_MESSAGE })
    .optional();

const nameSchema = z.string().trim()
    .min(2, { message: 'Name must be at least 2 characters long' })
    .max(60, { message: 'Name must be at most 60 characters long' });

const signupSchema = z.strictObject({
    email: z.string().trim().toLowerCase().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' }).max(128),
    name: nameSchema,
    phone: phoneSchema,
});

const loginSchema = z.strictObject({
    email: z.string().trim().toLowerCase().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' }).max(128),
});

// Only name and phone: changing a password or email needs proof of the current password, which a
// session alone is not, so those arrive later as their own confirmed flows.
const updateProfileSchema = z.strictObject({
    name: nameSchema.optional(),
    phone: phoneSchema,
});

const adminUpdateUserSchema = z.strictObject({
    name: nameSchema.optional(),
    email: z.string().trim().toLowerCase().email({ message: 'Invalid email address' }).optional(),
    phone: phoneSchema,
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
}).refine((body) => body.reason === undefined || body.isActive === false, {
    // Only a suspension keeps a reason; accepting one on any other change would silently drop it.
    message: 'A reason can only be given when suspending an account',
    path: ['reason'],
});

const userListQuerySchema = z.strictObject({
    page: pageSchema,
    limit: limitSchema,
    role: roleSchema.optional(),
    search: searchSchema,
});

module.exports = {
    signupSchema,
    loginSchema,
    updateProfileSchema,
    adminUpdateUserSchema,
    userListQuerySchema,
};
