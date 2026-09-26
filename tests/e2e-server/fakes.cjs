// Deterministic stand-ins for external providers, installed only by the e2e server.
const aiService = require('../../services/aiService');
const googleOAuthService = require('../../services/googleOAuthService');
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
  // Google sign-in without Google: the "consent screen" sends the browser straight back to the
  // callback, and the exchange returns one fixed test identity.
  // The first email-change notice to a fail-once- address fails, as a provider outage would; an
  // administrator's retry then succeeds. Every other email goes to the test outbox.
  const emailService = require('../../services/emailService');
  const { JobError } = require('../../services/jobs/jobError');
  const send = emailService.emailTransport.send;
  const failedOnce = new Set();
  emailService.emailTransport.send = async (message) => {
    if (message.kind === 'email_change_notice' && /^fail-once-/.test(message.to) && !failedOnce.has(message.to)) {
      failedOnce.add(message.to);
      throw JobError.of('PROVIDER_DOWN');
    }
    return send(message);
  };
  googleOAuthService.isConfigured = () => true;
  googleOAuthService.buildAuthUrl = (state) => `http://127.0.0.1:8181/api/v1/auth/google/callback?code=e2e-code&state=${state}`;
  googleOAuthService.exchangeCodeForProfile = async () => ({
    googleId: 'e2e-google-citizen',
    email: 'google.citizen@e2e.test',
    emailVerified: true,
    name: 'Gina Google',
  });
};

module.exports = { install };
