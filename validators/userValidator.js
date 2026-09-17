const { z } = require('zod');

const signupSchema = z.object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' }),
    name: z.string()
        .min(2, { message: 'Name must be at least 2 characters long' })
        .max(60, { message: 'Name must be at most 60 characters long' }),
    phone: z.string().optional(),
});

const loginSchema = z.object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' }),
});

const updateProfileSchema = signupSchema.partial();

const adminUpdateUserSchema = z.object({
    name: z.string().min(2).max(60).optional(),
    email: z.string().email({ message: 'Invalid email address' }).optional(),
    phone: z.string().optional(),
    role: z.enum(['citizen', 'admin', 'agency']).optional(),
});

module.exports = {
    signupSchema,
    loginSchema,
    updateProfileSchema,
    adminUpdateUserSchema,
};
