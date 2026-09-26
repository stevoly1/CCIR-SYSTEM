// BullMQ ignores an add whose job id exists, so relaying an entry twice queues it once. The attempt
// is part of the id, so a retry is a new job. Ids may not contain ':' (BullMQ's key separator).
const jobIdFor = ({ _id, runKey, attempts = 0 }) => `${_id}-${runKey}-${attempts}`;

module.exports = { jobIdFor };
