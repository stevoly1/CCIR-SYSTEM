const { z } = require('zod');

const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id' });

const createComplaintSchema = z.object({
    description: z.string()
        .min(10, { message: 'Description must be at least 10 characters long' })
        .max(2000, { message: 'Description must be at most 2000 characters long' }),
    categoryId: objectId.optional(),
    address: z.string().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
});

const updateComplaintSchema = z.object({
    description: z.string().min(10).max(2000).optional(),
    address: z.string().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
});

const updateStatusSchema = z.object({
    status: z.enum(STATUSES),
    note: z.string().max(500).optional(),
    priority: z.enum(PRIORITIES).optional(),
});

const assignComplaintSchema = z.object({
    assignedTo: objectId,
});

module.exports = {
    createComplaintSchema,
    updateComplaintSchema,
    updateStatusSchema,
    assignComplaintSchema,
};
