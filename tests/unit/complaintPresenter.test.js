const mongoose = require('mongoose');
const { presentComplaint, presentComplaintSummary } = require('../../presenters/complaintPresenter');

const id = () => new mongoose.Types.ObjectId();
const reporterId = id();
const adminId = id();
const agencyId = id();
const user = (_id, name, role, extra = {}) => ({ _id, name, role, isActive: true, ...extra });

const complaint = (overrides = {}) => ({
  _id: id(),
  __v: 3,
  referenceCode: 'CCIR-TEST-1',
  description: 'Deep pothole outside the school gate',
  status: 'IN_REVIEW',
  priority: 'HIGH',
  images: [{ url: 'https://img.test/1.jpg', publicId: 'secret-public-id' }],
  location: { address: '1 School Road', latitude: 6.5, longitude: 3.3, coordinateSource: 'DEVICE' },
  category: { _id: id(), name: 'Roads', isActive: true },
  ai: { suggestedCategory: 'Roads', confidence: 0.91, summary: 'Pothole', tags: ['road'], classifiedAt: new Date(), error: 'NONE' },
  reporter: user(reporterId, 'Ada Reporter', 'citizen', { email: 'ada@example.test', phone: '+2340000' }),
  reporterSnapshot: { userId: reporterId, displayName: 'Ada Reporter', role: 'citizen' },
  assignedTo: user(agencyId, 'Bola Agency', 'agency'),
  statusHistory: [
    { _id: id(), type: 'CREATED', status: 'PENDING', publicNote: 'Report submitted', changedBy: user(reporterId, 'Ada Reporter', 'citizen'), createdAt: new Date('2026-09-01') },
    { _id: id(), type: 'STATUS_CHANGED', status: 'IN_REVIEW', publicNote: 'Checking', internalNote: 'Contractor quote pending', changedBy: user(adminId, 'Chi Admin', 'admin'), createdAt: new Date('2026-09-02') },
  ],
  assignmentHistory: [
    { type: 'ASSIGNED', previous: null, next: { userId: agencyId, displayName: 'Bola Agency', role: 'agency' }, changedBy: { userId: adminId, displayName: 'Chi Admin', role: 'admin' }, reason: 'Nearest crew', createdAt: new Date('2026-09-02') },
  ],
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-02'),
  ...overrides,
});

const owner = { userId: String(reporterId), role: 'citizen' };
const admin = { userId: String(adminId), role: 'admin' };

const collectKeys = (value, keys = new Set()) => {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId)) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
};

describe('complaint presenter', () => {
  it('gives the owner only allow-listed fields', () => {
    const view = presentComplaint(complaint(), owner);
    const keys = collectKeys(view);
    for (const forbidden of ['internalNote', 'email', 'phone', 'latitude', 'longitude', 'assignmentHistory', 'editHistory', 'confidence', 'error', 'publicId', 'assignee', 'actor']) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    expect(JSON.stringify(view)).not.toMatch(/Bola Agency|Chi Admin|Contractor quote|ada@example|\+2340000/);
    expect(view.reporter).toEqual({ userId: reporterId, displayName: 'Ada Reporter', role: 'citizen' });
    expect(view).toMatchObject({
      version: 3,
      address: '1 School Road',
      hasPrecisePosition: true,
      responsibility: 'ASSIGNED',
      ai: { summary: 'Pothole', tags: ['road'] },
      images: [{ url: 'https://img.test/1.jpg' }],
    });
    expect(view.timeline.map((entry) => entry.actorLabel)).toEqual(['You', 'Administrator']);
    expect(view.timeline[1]).toEqual(expect.objectContaining({ publicNote: 'Checking', type: 'STATUS_CHANGED' }));
  });

  it('gives staff the full view with contact-free identities', () => {
    const view = presentComplaint(complaint(), admin);
    expect(view.reporter).toEqual({ userId: reporterId, displayName: 'Ada Reporter', role: 'citizen' });
    expect(view.assignee).toMatchObject({ userId: agencyId, displayName: 'Bola Agency', role: 'agency' });
    expect(view.location).toEqual({ address: '1 School Road', latitude: 6.5, longitude: 3.3, coordinateSource: 'DEVICE' });
    expect(view.timeline[1]).toMatchObject({ internalNote: 'Contractor quote pending', actor: { displayName: 'Chi Admin', role: 'admin' } });
    expect(view.assignmentHistory[0]).toMatchObject({ type: 'ASSIGNED', reason: 'Nearest crew' });
    expect(view.allowedTransitions).toEqual(['PENDING', 'IN_PROGRESS', 'REJECTED']);
    expect(JSON.stringify(view)).not.toMatch(/ada@example|\+2340000|secret-public-id/);
  });

  it('summaries carry no history, notes, or coordinates for any role', () => {
    for (const viewer of [owner, admin]) {
      const keys = collectKeys(presentComplaintSummary(complaint(), viewer));
      for (const forbidden of ['timeline', 'statusHistory', 'assignmentHistory', 'editHistory', 'internalNote', 'publicNote', 'latitude', 'longitude']) {
        expect(keys.has(forbidden), forbidden).toBe(false);
      }
    }
    expect(presentComplaintSummary(complaint(), owner)).toMatchObject({
      description: 'Deep pothole outside the school gate',
      thumbnailUrl: 'https://img.test/1.jpg',
      imageCount: 1,
    });
    expect(presentComplaintSummary(complaint(), owner).assignee).toBeUndefined();
    expect(presentComplaintSummary(complaint(), owner).reporter).toBeUndefined();
    expect(presentComplaintSummary(complaint(), admin).assignee).toMatchObject({ displayName: 'Bola Agency' });
    expect(presentComplaintSummary(complaint(), admin).reporter).toEqual({ userId: reporterId, displayName: 'Ada Reporter', role: 'citizen' });
    expect(JSON.stringify(presentComplaintSummary(complaint(), admin))).not.toMatch(/ada@example|\+2340000/);
  });

  it('labels a missing actor as System and orders the timeline oldest first', () => {
    const view = presentComplaint(complaint({
      statusHistory: [
        { _id: id(), type: 'STATUS_CHANGED', status: 'IN_REVIEW', createdAt: new Date('2026-09-03') },
        { _id: id(), type: 'CREATED', status: 'PENDING', createdAt: new Date('2026-09-01') },
      ],
    }), owner);
    expect(view.timeline.map((entry) => [entry.type, entry.actorLabel])).toEqual([['CREATED', 'System'], ['STATUS_CHANGED', 'System']]);
  });

  it('labels an unassigned complaint as awaiting assignment', () => {
    expect(presentComplaint(complaint({ assignedTo: undefined }), owner).responsibility).toBe('AWAITING_ASSIGNMENT');
  });
});
