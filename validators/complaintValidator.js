const { z } = require('zod');
const {
    addCoordinatePairIssue,
    latitudeSchema,
    limitSchema,
    longitudeSchema,
    objectIdSchema,
    pageSchema,
    searchSchema,
    sortSchema,
} = require('./commonValidator');

const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'WITHDRAWN'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const locationFields = {
    address: z.string().trim().max(500).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
};

const createComplaintSchema = z.strictObject({
    description: z.string().trim()
        .min(10, { message: 'Description must be at least 10 characters long' })
        .max(2000, { message: 'Description must be at most 2000 characters long' }),
    categoryId: objectIdSchema.optional(),
    ...locationFields,
}).superRefine(addCoordinatePairIssue);

const updateComplaintSchema = z.strictObject({
    description: z.string().trim().min(10).max(2000).optional(),
    ...locationFields,
}).superRefine(addCoordinatePairIssue);

const updateStatusSchema = z.strictObject({
    status: z.enum(STATUSES),
    publicNote: z.string().trim().max(500).optional(),
    internalNote: z.string().trim().max(1000).optional(),
    priority: z.enum(PRIORITIES).optional(),
});

const assignComplaintSchema = z.strictObject({
    assignedTo: objectIdSchema.nullable(),
    reason: z.string().trim().min(1).max(500).optional(),
});

const complaintListQuerySchema = z.strictObject({
    page: pageSchema,
    limit: limitSchema,
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    category: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
    search: searchSchema,
    sort: sortSchema,
});

module.exports = {
    createComplaintSchema,
    updateComplaintSchema,
    updateStatusSchema,
    assignComplaintSchema,
    complaintListQuerySchema,
};
