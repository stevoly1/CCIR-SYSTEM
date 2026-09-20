const { BadRequestError, ConflictError } = require('../errors');

const ALLOWED = Object.freeze({
  PENDING: new Set(['IN_REVIEW', 'REJECTED']),
  IN_REVIEW: new Set(['PENDING', 'IN_PROGRESS', 'REJECTED']),
  IN_PROGRESS: new Set(['IN_REVIEW', 'RESOLVED', 'REJECTED']),
  RESOLVED: new Set(['IN_PROGRESS']),
  REJECTED: new Set(['PENDING']),
});

const REASON_REQUIRED = new Set([
  'IN_REVIEW>PENDING',
  'IN_PROGRESS>IN_REVIEW',
  'RESOLVED>IN_PROGRESS',
  'REJECTED>PENDING',
]);
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const decideTransition = ({ from, to, reason, priority, now = new Date() }) => {
  if (!ALLOWED[from]?.has(to)) {
    throw new ConflictError(`Complaint cannot transition from ${from} to ${to}`);
  }

  if (reason !== undefined && typeof reason !== 'string') {
    throw new BadRequestError('Transition reason must be a string');
  }

  const normalizedReason = reason?.trim();
  if (normalizedReason && normalizedReason.length > 500) {
    throw new BadRequestError('Transition reason must be at most 500 characters');
  }

  if (REASON_REQUIRED.has(`${from}>${to}`) && !normalizedReason) {
    throw new ConflictError('A reason is required for this complaint transition');
  }

  if (priority !== undefined && !PRIORITIES.has(priority)) {
    throw new BadRequestError('Invalid complaint priority');
  }

  const resolvedAtAction = to === 'RESOLVED'
    ? 'set'
    : from === 'RESOLVED'
      ? 'clear'
      : 'preserve';

  return {
    status: to,
    priority,
    resolvedAtAction,
    historyEntry: {
      status: to,
      note: normalizedReason || undefined,
      createdAt: now,
    },
  };
};

module.exports = { decideTransition };
