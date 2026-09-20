const { z } = require('zod');
const {
    limitSchema,
    pageSchema,
    searchSchema,
} = require('./commonValidator');

const roleSchema = z.enum(['citizen', 'admin', 'agency']);

const signupSchema = z.strictObject({
    email: z.string().trim().toLowerCase().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' }).max(128),
    name: z.string().trim()
        .min(2, { message: 'Name must be at least 2 characters long' })
        .max(60, { message: 'Name must be at most 60 characters long' }),
    phone: z.string().trim().max(30).optional(),
});

const loginSchema = z.strictObject({
    email: z.string().trim().toLowerCase().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' }).max(128),
});

const updateProfileSchema = signupSchema.partial();

const adminUpdateUserSchema = z.strictObject({
    name: z.string().trim().min(2).max(60).optional(),
    email: z.string().trim().toLowerCase().email({ message: 'Invalid email address' }).optional(),
    phone: z.string().trim().max(30).optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
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
