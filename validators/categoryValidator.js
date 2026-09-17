const { z } = require('zod');

const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const createCategorySchema = z.object({
    name: z.string().min(2, { message: 'Category name must be at least 2 characters' }),
    description: z.string().optional(),
    defaultPriority: prioritySchema.optional(),
    isActive: z.boolean().optional(),
});

const updateCategorySchema = createCategorySchema.partial();

module.exports = {
    createCategorySchema,
    updateCategorySchema,
};
