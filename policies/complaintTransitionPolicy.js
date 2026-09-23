const { BadRequestError, ConflictError } = require('../errors');
const { noChange } = require('../errors/domainErrors');

const ALLOWED = Object.freeze({
  PENDING: new Set(['IN_REVIEW', 'REJECTED']),
  IN_REVIEW: new Set(['PENDING', 'IN_PROGRESS', 'REJECTED']),
  IN_PROGRESS: new Set(['IN_REVIEW', 'RESOLVED', 'REJECTED']),
  RESOLVED: new Set(['IN_PROGRESS']),
  REJECTED: new Set(['PENDING']),
  // Only the reporter's withdraw action enters WITHDRAWN; no staff transition leaves it.
  WITHDRAWN: new Set(),
});

const PUBLIC_NOTE_REQUIRED = new Set([
  'IN_REVIEW>PENDING',
  'IN_PROGRESS>IN_REVIEW',
  'RESOLVED>IN_PROGRESS',
  'REJECTED>PENDING',
]);
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const normaliseNote = (value, max, label) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestError(`${label} must be at most ${max} characters`);
  return trimmed || undefined;
};

const decideTransition = ({ from, to, publicNote, internalNote, priority, currentPriority, now = new Date() }) => {
  if (!ALLOWED[from]?.has(to)) {
    throw new ConflictError(`Complaint cannot transition from ${from} to ${to}`);
  }

  const publicText = normaliseNote(publicNote, 500, 'Public note');
  const internalText = normaliseNote(internalNote, 1000, 'Internal note');

  // Backward moves and every rejection must tell the reporter why.
  const publicNoteRequired = PUBLIC_NOTE_REQUIRED.has(`${from}>${to}`) || to === 'REJECTED';
  if (publicNoteRequired && !publicText) {
    throw new ConflictError('A public note is required for this complaint transition');
  }

  if (priority !== undefined && !PRIORITIES.has(priority)) {
    throw new BadRequestError('Invalid complaint priority');
  }

  const resolvedAtAction = to === 'RESOLVED'
    ? 'set'
    : from === 'RESOLVED'
      ? 'clear'
      : 'preserve';

  const historyEntry = { type: 'STATUS_CHANGED', status: to, createdAt: now };
  if (publicText) historyEntry.publicNote = publicText;
  if (internalText) historyEntry.internalNote = internalText;
  if (priority !== undefined && currentPriority !== undefined && priority !== currentPriority) {
    historyEntry.priorityChange = { from: currentPriority, to: priority };
  }

  return { status: to, priority, resolvedAtAction, historyEntry };
};

// Priority-only update: no status transition, one PRIORITY_CHANGED timeline entry.
const decidePriorityChange = ({ status, currentPriority, priority, publicNote, internalNote, now = new Date() }) => {
  if (!PRIORITIES.has(priority)) throw new BadRequestError('Invalid complaint priority');
  if (priority === currentPriority) throw noChange();
  const publicText = normaliseNote(publicNote, 500, 'Public note');
  const internalText = normaliseNote(internalNote, 1000, 'Internal note');
  const historyEntry = {
    type: 'PRIORITY_CHANGED',
    status,
    priorityChange: { from: currentPriority, to: priority },
    createdAt: now,
  };
  if (publicText) historyEntry.publicNote = publicText;
  if (internalText) historyEntry.internalNote = internalText;
  return { priority, historyEntry };
};

module.exports = { ALLOWED, decideTransition, decidePriorityChange };
