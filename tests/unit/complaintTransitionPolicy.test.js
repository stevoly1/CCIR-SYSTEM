const { ConflictError, BadRequestError } = require('../../errors');
const { decideTransition, decidePriorityChange } = require('../../policies/complaintTransitionPolicy');

describe('complaint transition policy', () => {
  const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'WITHDRAWN'];
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
  const publicNoteRequired = new Set([
    'IN_REVIEW>PENDING',
    'IN_PROGRESS>IN_REVIEW',
    'RESOLVED>IN_PROGRESS',
    'REJECTED>PENDING',
    'PENDING>REJECTED',
    'IN_REVIEW>REJECTED',
    'IN_PROGRESS>REJECTED',
  ]);
  const now = new Date('2026-09-20T01:00:00.000Z');

  it.each(STATUSES.flatMap((from) => STATUSES.map((to) => [from, to])))('%s -> %s matches the policy', (from, to) => {
    const invoke = () => decideTransition({ from, to, publicNote: 'Correction required', now });
    if (allowed.has(`${from}>${to}`)) {
      expect(invoke()).toMatchObject({ status: to });
    } else {
      expect(invoke).toThrow(ConflictError);
    }
  });

  it.each([...publicNoteRequired])('requires a non-empty public note for %s', (pair) => {
    const [from, to] = pair.split('>');
    expect(() => decideTransition({ from, to, now })).toThrow(ConflictError);
    expect(() => decideTransition({ from, to, publicNote: '   ', now })).toThrow(ConflictError);
    expect(() => decideTransition({ from, to, internalNote: 'staff only', now })).toThrow(ConflictError);
  });

  it.each([...publicNoteRequired])('accepts and trims a public note for %s', (pair) => {
    const [from, to] = pair.split('>');
    const decision = decideTransition({ from, to, publicNote: '  Correction required  ', now });
    expect(decision.historyEntry.publicNote).toBe('Correction required');
  });

  it('rejects any public note longer than 500 characters', () => {
    expect(() => decideTransition({
      from: 'PENDING',
      to: 'IN_REVIEW',
      publicNote: 'x'.repeat(501),
      now,
    })).toThrow(BadRequestError);
  });

  it('rejects any internal note longer than 1000 characters', () => {
    expect(() => decideTransition({
      from: 'PENDING',
      to: 'IN_REVIEW',
      internalNote: 'x'.repeat(1001),
      now,
    })).toThrow(BadRequestError);
  });

  it.each([
    ['IN_PROGRESS', 'RESOLVED', 'set'],
    ['RESOLVED', 'IN_PROGRESS', 'clear'],
    ['PENDING', 'IN_REVIEW', 'preserve'],
    ['IN_REVIEW', 'REJECTED', 'preserve'],
  ])('returns the timestamp action for %s -> %s', (from, to, resolvedAtAction) => {
    expect(decideTransition({ from, to, publicNote: 'Required where applicable', now })).toMatchObject({
      resolvedAtAction,
      historyEntry: { type: 'STATUS_CHANGED', status: to, createdAt: now },
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
    expect(() => decideTransition({ from, to, publicNote: 'Nope', now })).toThrow(ConflictError);
  });

  it('records a priority-only change with optional notes', () => {
    expect(decidePriorityChange({ status: 'IN_REVIEW', currentPriority: 'LOW', priority: 'HIGH', internalNote: ' ops ', now })).toEqual({
      priority: 'HIGH',
      historyEntry: {
        type: 'PRIORITY_CHANGED',
        status: 'IN_REVIEW',
        priorityChange: { from: 'LOW', to: 'HIGH' },
        internalNote: 'ops',
        createdAt: now,
      },
    });
  });

  it('refuses a priority-only no-op and an invalid priority', () => {
    expect(() => decidePriorityChange({ status: 'IN_REVIEW', currentPriority: 'LOW', priority: 'LOW', now }))
      .toThrow(expect.objectContaining({ code: 'NO_CHANGE' }));
    expect(() => decidePriorityChange({ status: 'IN_REVIEW', currentPriority: 'LOW', priority: 'URGENT', now }))
      .toThrow(BadRequestError);
  });

  it('never allows staff transitions into or out of WITHDRAWN', () => {
    for (const status of ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']) {
      expect(() => decideTransition({ from: status, to: 'WITHDRAWN', publicNote: 'x', now })).toThrow(ConflictError);
      expect(() => decideTransition({ from: 'WITHDRAWN', to: status, publicNote: 'x', now })).toThrow(ConflictError);
    }
  });

  it('builds a typed history entry with separate notes and a priority change', () => {
    const decision = decideTransition({
      from: 'PENDING',
      to: 'IN_REVIEW',
      publicNote: ' Checking ',
      internalNote: ' crew B ',
      priority: 'HIGH',
      currentPriority: 'LOW',
      now,
    });
    expect(decision.historyEntry).toEqual({
      type: 'STATUS_CHANGED',
      status: 'IN_REVIEW',
      publicNote: 'Checking',
      internalNote: 'crew B',
      priorityChange: { from: 'LOW', to: 'HIGH' },
      createdAt: now,
    });
  });

  it('omits priorityChange and blank notes when nothing else changes', () => {
    const decision = decideTransition({
      from: 'PENDING',
      to: 'IN_REVIEW',
      publicNote: '   ',
      priority: 'LOW',
      currentPriority: 'LOW',
      now,
    });
    expect(decision.historyEntry).toEqual({ type: 'STATUS_CHANGED', status: 'IN_REVIEW', createdAt: now });
  });
});
