const mongoose = require('mongoose');
const { decideAssignment } = require('../../policies/assignmentPolicy');
const { buildUserSnapshot } = require('../../services/userSnapshotService');
const { ConflictError, ForbiddenError } = require('../../errors');
const Complaint = require('../../models/Complaint');
const User = require('../../models/User');

describe('assignment policy', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');
  const activeAdmin = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Ada Admin',
    email: 'ada@example.test',
    phone: '+234000000001',
    password: 'not-for-history',
    role: 'admin',
    isActive: true,
  };
  const firstAgency = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Roads Agency',
    email: 'roads@example.test',
    phone: '+234000000002',
    avatarUrl: 'https://example.test/avatar.png',
    role: 'agency',
    isActive: true,
  };
  const secondAgency = {
    ...firstAgency,
    _id: new mongoose.Types.ObjectId(),
    name: 'Works Agency',
  };

  it('assigns an active agency and records contact-free snapshots', () => {
    const result = decideAssignment({
      actor: activeAdmin,
      target: firstAgency,
      currentAssignee: null,
      reason: 'Routing',
      now,
    });

    expect(String(result.assignedTo)).toBe(String(firstAgency._id));
    expect(result.event).toEqual({
      type: 'ASSIGNED',
      previous: null,
      next: buildUserSnapshot(firstAgency),
      changedBy: buildUserSnapshot(activeAdmin),
      reason: 'Routing',
      createdAt: now,
    });
    expect(JSON.stringify(result.event)).not.toMatch(/email|phone|avatar|password/i);
  });

  it('builds a contact-free reassignment event', () => {
    const result = decideAssignment({
      actor: activeAdmin,
      target: secondAgency,
      currentAssignee: firstAgency,
      reason: 'Coverage',
      now,
    });

    expect(result.event).toMatchObject({ type: 'REASSIGNED', reason: 'Coverage', createdAt: now });
    expect(result.event.previous).toEqual(buildUserSnapshot(firstAgency));
    expect(result.event.next).toEqual(buildUserSnapshot(secondAgency));
    expect(JSON.stringify(result.event)).not.toMatch(/email|phone|avatar|password/i);
  });

  it('unassigns without requiring a target', () => {
    const result = decideAssignment({ actor: activeAdmin, target: null, currentAssignee: firstAgency, now });

    expect(result.assignedTo).toBeNull();
    expect(result.event).toMatchObject({ type: 'UNASSIGNED', previous: buildUserSnapshot(firstAgency), next: null });
  });

  it.each(['citizen', 'admin'])('rejects %s as a target', (role) => {
    expect(() => decideAssignment({
      actor: activeAdmin,
      target: { ...firstAgency, role },
      currentAssignee: null,
      reason: 'Routing',
      now,
    })).toThrow(ConflictError);
  });

  it.each([
    { ...activeAdmin, role: 'citizen' },
    { ...activeAdmin, role: 'agency' },
    { ...activeAdmin, isActive: false },
    { ...activeAdmin, retiredAt: now },
  ])('rejects an actor without active administrator authority', (actor) => {
    expect(() => decideAssignment({ actor, target: firstAgency, currentAssignee: null, now })).toThrow(ForbiddenError);
  });

  it.each([
    { ...firstAgency, isActive: false },
    { ...firstAgency, retiredAt: now },
  ])('rejects an inactive or retired agency target', (target) => {
    expect(() => decideAssignment({ actor: activeAdmin, target, currentAssignee: null, now })).toThrow(ConflictError);
  });

  it('rejects assignment to the current assignee', () => {
    expect(() => decideAssignment({
      actor: activeAdmin,
      target: { ...firstAgency },
      currentAssignee: firstAgency,
      now,
    })).toThrow(ConflictError);
  });

  it('treats a legacy user without isActive as active until migration', () => {
    expect(() => decideAssignment({
      actor: { ...activeAdmin, isActive: undefined },
      target: { ...firstAgency, isActive: undefined },
      currentAssignee: null,
      now,
    })).not.toThrow();
  });

  it('defines the approved user activity and assignment-history schema', () => {
    const isActive = User.schema.path('isActive');
    const assignmentHistory = Complaint.schema.path('assignmentHistory');
    const eventType = assignmentHistory.schema.path('type');
    const reason = assignmentHistory.schema.path('reason');
    const migrationMarker = assignmentHistory.schema.path('migrationMarker');

    expect(isActive.instance).toBe('Boolean');
    expect(isActive.defaultValue).toBe(true);
    expect(eventType.enumValues).toEqual([
      'ASSIGNED',
      'REASSIGNED',
      'UNASSIGNED',
      'RETIREMENT_UNASSIGNMENT',
      'WITHDRAWAL_UNASSIGNMENT',
      'LEGACY_STATE_IMPORT',
    ]);
    expect(reason.options.maxlength).toBe(500);
    expect(migrationMarker.enumValues).toEqual(['PHASE_1_MIGRATION']);
  });

  it('requires exactly one administrator snapshot or migration marker per event', async () => {
    const base = {
      referenceCode: 'TEST-AUTHOR-INVARIANT',
      description: 'A complaint used to validate assignment history authorship',
      category: new mongoose.Types.ObjectId(),
      reporter: new mongoose.Types.ObjectId(),
    };
    const event = {
      type: 'LEGACY_STATE_IMPORT',
      previous: null,
      next: buildUserSnapshot(firstAgency),
      createdAt: now,
    };

    await expect(new Complaint({ ...base, assignmentHistory: [{ ...event, migrationMarker: 'PHASE_1_MIGRATION' }] }).validate()).resolves.toBeUndefined();
    await expect(new Complaint({ ...base, assignmentHistory: [event] }).validate()).rejects.toMatchObject({ name: 'ValidationError' });
    await expect(new Complaint({
      ...base,
      assignmentHistory: [{ ...event, changedBy: buildUserSnapshot(activeAdmin), migrationMarker: 'PHASE_1_MIGRATION' }],
    }).validate()).rejects.toMatchObject({ name: 'ValidationError' });
  });
});
