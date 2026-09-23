const { z } = require('zod');

const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const createCategorySchema = z.strictObject({
    name: z.string().trim()
        .min(2, { message: 'Category name must be at least 2 characters' })
        .max(60, { message: 'Category name must be at most 60 characters' }),
    description: z.string().trim().max(1000).optional(),
    defaultPriority: prioritySchema.optional(),
    isActive: z.boolean().optional(),
});

const updateCategorySchema = createCategorySchema.partial();

module.exports = {
    createCategorySchema,
    updateCategorySchema,
};
