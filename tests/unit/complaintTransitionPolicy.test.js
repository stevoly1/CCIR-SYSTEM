const { ConflictError, BadRequestError } = require('../../errors');
const { decideTransition } = require('../../policies/complaintTransitionPolicy');

describe('complaint transition policy', () => {
  const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
  const allowed = new Set([
    'PENDING>IN_REVIEW',
    'PENDING>REJECTED',
    'IN_REVIEW>PENDING',
    'IN_REVIEW>IN_PROGRESS',
    'IN_REVIEW>REJECTED',
    'IN_PROGRESS>IN_REVIEW',
    'IN_PROGRESS>RESOLVED',
    'IN_PROGRESS>REJECTED',
    'RESOLVED>IN_PROGRESS',
    'REJECTED>PENDING',
  ]);
  const reasonRequired = new Set([
    'IN_REVIEW>PENDING',
    'IN_PROGRESS>IN_REVIEW',
    'RESOLVED>IN_PROGRESS',
    'REJECTED>PENDING',
  ]);
  const now = new Date('2026-09-20T01:00:00.000Z');

  it.each(STATUSES.flatMap((from) => STATUSES.map((to) => [from, to])))('%s -> %s matches the policy', (from, to) => {
    const invoke = () => decideTransition({ from, to, reason: 'Correction required', now });
    if (allowed.has(`${from}>${to}`)) {
      expect(invoke()).toMatchObject({ status: to });
    } else {
      expect(invoke).toThrow(ConflictError);
    }
  });

  it.each([...reasonRequired])('requires a non-empty reason for %s', (pair) => {
    const [from, to] = pair.split('>');
    expect(() => decideTransition({ from, to, now })).toThrow(ConflictError);
    expect(() => decideTransition({ from, to, reason: '   ', now })).toThrow(ConflictError);
  });

  it.each([...reasonRequired])('accepts and trims a reason for %s', (pair) => {
    const [from, to] = pair.split('>');
    const decision = decideTransition({ from, to, reason: '  Correction required  ', now });
    expect(decision.historyEntry.note).toBe('Correction required');
  });

  it('rejects any reason longer than 500 characters', () => {
    expect(() => decideTransition({
      from: 'PENDING',
      to: 'IN_REVIEW',
      reason: 'x'.repeat(501),
      now,
    })).toThrow(BadRequestError);
  });

  it.each([
    ['IN_PROGRESS', 'RESOLVED', 'set'],
    ['RESOLVED', 'IN_PROGRESS', 'clear'],
    ['PENDING', 'IN_REVIEW', 'preserve'],
    ['IN_REVIEW', 'REJECTED', 'preserve'],
  ])('returns the timestamp action for %s -> %s', (from, to, resolvedAtAction) => {
    expect(decideTransition({ from, to, reason: 'Required where applicable', now })).toMatchObject({
      resolvedAtAction,
      historyEntry: { status: to, createdAt: now },
    });
  });

  it('returns an optional priority only after accepting the transition', () => {
    expect(decideTransition({
      from: 'PENDING',
      to: 'IN_REVIEW',
      priority: 'HIGH',
      now,
    })).toMatchObject({ status: 'IN_REVIEW', priority: 'HIGH' });
  });

  it('rejects an invalid priority on an otherwise legal transition', () => {
    expect(() => decideTransition({
      from: 'PENDING',
      to: 'IN_REVIEW',
      priority: 'URGENT',
      now,
    })).toThrow(BadRequestError);
  });

  it('rejects a duplicate transition even when it contains a priority change', () => {
    expect(() => decideTransition({
      from: 'PENDING',
      to: 'PENDING',
      priority: 'CRITICAL',
      now,
    })).toThrow(ConflictError);
  });

  it.each([
    ['UNKNOWN', 'PENDING'],
    ['PENDING', 'UNKNOWN'],
  ])('rejects an unknown transition endpoint %s -> %s', (from, to) => {
    expect(() => decideTransition({ from, to, reason: 'Nope', now })).toThrow(ConflictError);
  });
});
