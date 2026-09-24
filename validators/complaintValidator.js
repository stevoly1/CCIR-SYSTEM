const { z } = require('zod');
const {
    limitSchema,
    objectIdSchema,
    pageSchema,
    searchSchema,
    sortSchema,
} = require('./commonValidator');
const { locationShape, refineLocation, locationObjectSchema } = require('./locationValidator');

const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'WITHDRAWN'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const createComplaintSchema = z.strictObject({
    description: z.string().trim()
        .min(10, { message: 'Description must be at least 10 characters long' })
        .max(2000, { message: 'Description must be at most 2000 characters long' }),
    categoryId: objectIdSchema.optional(),
    ...locationShape,
}).superRefine(refineLocation);

const expectedVersionSchema = z.number().int().min(0).optional();

const deleteComplaintSchema = z.strictObject({
    reason: z.string().trim()
        .min(1, { message: 'A reason is required to delete a report permanently' })
        .max(500),
    expectedVersion: expectedVersionSchema,
});

const withdrawComplaintSchema = z.strictObject({
    reason: z.string().trim().min(1).max(500).optional(),
    expectedVersion: expectedVersionSchema,
});

const updateComplaintSchema = z.strictObject({
    description: z.string().trim().min(10).max(2000).optional(),
    location: locationObjectSchema.optional(),
    expectedVersion: expectedVersionSchema,
}).superRefine((value, context) => {
    if (value.description === undefined && value.location === undefined) {
        context.addIssue({ code: 'custom', path: ['description'], message: 'Provide a description or a location' });
    }
});

const updateStatusSchema = z.strictObject({
    status: z.enum(STATUSES).optional(),
    publicNote: z.string().trim().max(500).optional(),
    internalNote: z.string().trim().max(1000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    expectedVersion: expectedVersionSchema,
}).superRefine((value, context) => {
    if (value.status === undefined && value.priority === undefined) {
        context.addIssue({ code: 'custom', path: ['status'], message: 'Provide a status or a priority' });
    }
});

const assignComplaintSchema = z.strictObject({
    assignedTo: objectIdSchema.nullable(),
    reason: z.string().trim().min(1).max(500).optional(),
    expectedVersion: expectedVersionSchema,
});

const complaintListQuerySchema = z.strictObject({
    page: pageSchema,
    limit: limitSchema,
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    category: objectIdSchema.optional(),
    // A staff member's id, or `none` for reports nobody is assigned to.
    assignedTo: z.union([objectIdSchema, z.literal('none')]).optional(),
    search: searchSchema,
    sort: sortSchema,
});

module.exports = {
    expectedVersionSchema,
    withdrawComplaintSchema,
    deleteComplaintSchema,
    createComplaintSchema,
    updateComplaintSchema,
    updateStatusSchema,
    assignComplaintSchema,
    complaintListQuerySchema,
};
