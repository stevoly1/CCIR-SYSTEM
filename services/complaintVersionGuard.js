const { staleComplaint } = require('../errors/domainErrors');

// Clients echo the `version` they loaded as `expectedVersion`; a mismatch means they
// acted on a stale view. Omitting it keeps the Phase 1 server-read behaviour.
const assertExpectedVersion = (complaint, expectedVersion) => {
  if (expectedVersion !== undefined && complaint.__v !== expectedVersion) throw staleComplaint();
};

const versionFilter = (complaint, expectedVersion) => {
  assertExpectedVersion(complaint, expectedVersion);
  return complaint.__v;
};

module.exports = { assertExpectedVersion, versionFilter };
