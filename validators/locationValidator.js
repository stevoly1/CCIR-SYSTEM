const { z } = require('zod');
const { latitudeSchema, longitudeSchema } = require('./commonValidator');

// Every complaint needs a human-readable address. Coordinates are optional extra
// precision, accepted only as a pair with a declared source; the server never infers them.
const COORDINATE_SOURCES = ['DEVICE', 'SUGGESTION'];

const locationShape = {
  address: z.string().trim()
    .min(3, { message: 'Address must be at least 3 characters' })
    .max(500, { message: 'Address must be at most 500 characters' }),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  coordinateSource: z.enum(COORDINATE_SOURCES).optional(),
};

const refineLocation = (value, context) => {
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    context.addIssue({
      code: 'custom',
      path: [hasLatitude ? 'longitude' : 'latitude'],
      message: 'Latitude and longitude must be supplied together',
    });
  }
  const hasPair = hasLatitude && hasLongitude;
  if (hasPair && value.latitude === 0 && value.longitude === 0) {
    context.addIssue({ code: 'custom', path: ['latitude'], message: 'Coordinates (0, 0) are not a valid report location' });
  }
  if (hasPair && !value.coordinateSource) {
    context.addIssue({ code: 'custom', path: ['coordinateSource'], message: 'coordinateSource is required with coordinates' });
  }
  if (!hasPair && value.coordinateSource) {
    context.addIssue({ code: 'custom', path: ['coordinateSource'], message: 'coordinateSource is allowed only with coordinates' });
  }
};

const locationObjectSchema = z.strictObject(locationShape).superRefine(refineLocation);

const buildLocation = ({ address, latitude, longitude, coordinateSource }) => ({
  address,
  ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude, coordinateSource } : {}),
});

module.exports = { COORDINATE_SOURCES, locationShape, refineLocation, locationObjectSchema, buildLocation };
