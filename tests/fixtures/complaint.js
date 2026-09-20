const Complaint = require('../../models/Complaint');
const { createCategoryFixture } = require('./category');
const { createUserFixture } = require('./user');

let sequence = 0;

const createComplaintFixture = async (overrides = {}) => {
  sequence += 1;
  const currentSequence = sequence;
  const category = overrides.category || await createCategoryFixture();
  const reporter = overrides.reporter || await createUserFixture();

  return Complaint.create({
    referenceCode: `TEST-${String(currentSequence).padStart(6, '0')}`,
    description: 'Fixture complaint description',
    category,
    reporter,
    ...overrides,
  });
};

module.exports = { createComplaintFixture };
