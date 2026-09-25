// BullMQ ignores an add whose job id exists, so relaying an entry twice queues it once.
// Ids may not contain ':' (BullMQ's key separator).
const jobIdFor = ({ _id, runKey }) => `${_id}-${runKey}`;

module.exports = { jobIdFor };
