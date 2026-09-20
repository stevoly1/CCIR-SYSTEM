const { z } = require('zod');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(OBJECT_ID_PATTERN, {
  message: 'A valid identifier is required',
});

const idParamsSchema = z.strictObject({ id: objectIdSchema });
const emptyQuerySchema = z.strictObject({});

const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
const searchSchema = z.string().trim().max(200).optional();
const sortSchema = z.enum(['newest', 'oldest']).default('newest');

const addCoordinatePairIssue = (value, context) => {
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;
  if (hasLatitude === hasLongitude) return;
  context.addIssue({
    code: 'custom',
    path: [hasLatitude ? 'longitude' : 'latitude'],
    message: 'Latitude and longitude must be supplied together',
  });
};

const latitudeSchema = z.coerce.number().min(-90).max(90);
const longitudeSchema = z.coerce.number().min(-180).max(180);

const retirementBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500).optional(),
});

const autocompleteQuerySchema = z.strictObject({
  input: z.string().trim().min(1).max(200),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
}).superRefine(addCoordinatePairIssue);

const geocodeQuerySchema = z.strictObject({
  address: z.string().trim().min(1).max(500).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
}).superRefine((value, context) => {
  addCoordinatePairIssue(value, context);
  const hasPair = value.latitude !== undefined && value.longitude !== undefined;
  if (!value.address && !hasPair && value.latitude === undefined && value.longitude === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['address'],
      message: 'An address or coordinate pair is required',
    });
  }
});

module.exports = {
  addCoordinatePairIssue,
  autocompleteQuerySchema,
  emptyQuerySchema,
  geocodeQuerySchema,
  idParamsSchema,
  latitudeSchema,
  limitSchema,
  longitudeSchema,
  objectIdSchema,
  pageSchema,
  retirementBodySchema,
  searchSchema,
  sortSchema,
};
