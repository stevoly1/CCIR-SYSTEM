// Deterministic stand-ins for external providers, installed only by the e2e server.
const aiService = require('../../services/aiService');
const locationService = require('../../services/locationService');
const uploadService = require('../../services/uploadService');

const RULES = [
  [/pothole|road/i, 'Roads', 'HIGH'],
  [/drain|flood/i, 'Drainage', 'MEDIUM'],
  [/light/i, 'Streetlights', 'LOW'],
];
let uploadCount = 0;

const install = () => {
  aiService.classifyComplaint = async ({ description }) => {
    const [, category, priority] = RULES.find(([pattern]) => pattern.test(description)) ?? [null, 'Other', 'LOW'];
    return {
      category,
      priority,
      summary: `AI summary: ${description.slice(0, 40)}`,
      tags: [category.toLowerCase()],
      confidence: 0.9,
      error: null,
    };
  };
  locationService.autocomplete = async () => ([
    { label: '12 Market Road, Ikeja', address: '12 Market Road, Ikeja', latitude: 6.6018, longitude: 3.3515 },
  ]);
  locationService.geocodeAddress = async () => ({ address: '12 Market Road, Ikeja', latitude: 6.6018, longitude: 3.3515 });
  locationService.reverseGeocode = async (latitude) => (Number(latitude) === 9.999 ? null : '5 Allen Avenue, Ikeja');
  uploadService.uploadComplaintImage = async () => {
    uploadCount += 1;
    return { url: `https://res.cloudinary.com/e2e/image/upload/${uploadCount}.jpg`, publicId: `e2e-${uploadCount}` };
  };
  uploadService.deleteComplaintImages = async () => [];
};

module.exports = { install };
