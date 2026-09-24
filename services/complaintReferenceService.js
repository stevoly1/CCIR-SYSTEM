const generateReferenceCode = require('../utils/referenceCode');

const MAX_ATTEMPTS = 5;
const isReferenceCollision = (error) => error?.code === 11000
  && Boolean(error.keyPattern?.referenceCode || error.keyValue?.referenceCode);

const referenceService = {
  generate: () => generateReferenceCode(),

  // Retries only the insert, with a fresh code, when the unique referenceCode index rejects it.
  // Callers do any expensive work (uploads, AI) before calling this.
  async createWithUniqueReference(create, { attempts = MAX_ATTEMPTS } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await create(referenceService.generate());
      } catch (error) {
        if (!isReferenceCollision(error)) throw error;
      }
    }
    throw new Error('Could not allocate a unique complaint reference code');
  },
};

module.exports = referenceService;
