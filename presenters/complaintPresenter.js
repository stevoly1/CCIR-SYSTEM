const { User } = require('../models');
const { safeHistoricalIdentity } = require('../services/userSnapshotService');
const authority = require('../policies/complaintAuthorityPolicy');

// Every complaint response body is built here, by allow-list: a field reaches a
// client only if it is named below, so new model fields stay private by default.

const IDENTITY_FIELDS = 'name role isActive retiredAt';
const COMPLAINT_POPULATE = [
  { path: 'category', select: 'name isActive' },
  { path: 'reporter', select: IDENTITY_FIELDS },
  { path: 'assignedTo', select: IDENTITY_FIELDS },
  { path: 'statusHistory.changedBy', select: IDENTITY_FIELDS },
];
// Summaries never show history, so list reads skip the per-entry actor lookups.
const SUMMARY_POPULATE = COMPLAINT_POPULATE.filter((entry) => entry.path !== 'statusHistory.changedBy');

// A populated user document carries `role`; a bare ObjectId does not.
const asPopulated = (value) => (value && typeof value === 'object' && 'role' in value ? value : undefined);
const idString = (value) => (value === null || value === undefined ? null : String(value._id ?? value));
const plain = (value) => (value && typeof value.toObject === 'function' ? value.toObject() : value);

const viewerFromRequest = (req) => ({ userId: String(req.user.userId), role: req.user.role });

const snapshotIdentity = (snapshot, identities) => {
  if (!snapshot) return null;
  return safeHistoricalIdentity({ populatedUser: identities.get(String(snapshot.userId)), snapshot });
};

const loadPresentationIdentities = async (complaints) => {
  const ids = complaints.flatMap((complaint) => [
    ...(complaint.assignmentHistory ?? []).flatMap((entry) => [entry.previous?.userId, entry.next?.userId, entry.changedBy?.userId]),
    ...(complaint.editHistory ?? []).map((entry) => entry.editedBy?.userId),
  ].filter(Boolean).map(String));
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: [...new Set(ids)] } }).select(IDENTITY_FIELDS);
  return new Map(users.map((user) => [String(user._id), user]));
};

const presentCategory = (complaint) => {
  const live = complaint.category && typeof complaint.category === 'object' && 'name' in complaint.category
    ? complaint.category
    : null;
  const recordedName = complaint.categorySnapshot?.name ?? live?.name ?? 'Unavailable category';
  return {
    _id: idString(live ?? complaint.categorySnapshot?.categoryId ?? complaint.category),
    name: live?.name ?? recordedName,
    recordedName,
    isActive: live ? live.isActive !== false : false,
    deleted: !live,
  };
};

const hasPrecisePosition = (complaint) => (
  typeof complaint.location?.latitude === 'number' && typeof complaint.location?.longitude === 'number'
);

const presentAssignee = (complaint) => {
  if (!complaint.assignedTo) return null;
  return safeHistoricalIdentity({
    populatedUser: asPopulated(complaint.assignedTo),
    snapshot: { userId: idString(complaint.assignedTo) },
  });
};

const presentReporter = (complaint) => safeHistoricalIdentity({
  populatedUser: asPopulated(complaint.reporter),
  snapshot: complaint.reporterSnapshot ?? { userId: idString(complaint.reporter) },
});

const presentComplaintSummary = (complaint, viewer) => {
  const images = complaint.images ?? [];
  const summary = {
    _id: String(complaint._id),
    referenceCode: complaint.referenceCode,
    status: complaint.status,
    priority: complaint.priority,
    description: complaint.description,
    category: presentCategory(complaint),
    address: complaint.location?.address ?? null,
    hasPrecisePosition: hasPrecisePosition(complaint),
    imageCount: images.length,
    thumbnailUrl: images[0]?.url ?? null,
    createdAt: complaint.createdAt,
    updatedAt: complaint.updatedAt,
  };
  if (authority.isStaff(viewer)) {
    summary.reporter = presentReporter(complaint);
    summary.assignee = presentAssignee(complaint);
  }
  return summary;
};

const ACTOR_LABELS = { admin: 'Administrator', agency: 'Agency staff', citizen: 'Reporter' };

const actorOf = (entry) => {
  if (!entry.changedBy && !entry.changedBySnapshot) return null;
  return safeHistoricalIdentity({
    populatedUser: asPopulated(entry.changedBy),
    snapshot: entry.changedBySnapshot ?? { userId: idString(entry.changedBy) },
  });
};

const presentTimelineEntry = (entry, viewer, staff) => {
  const actor = actorOf(entry);
  const actorId = actor ? idString(actor.userId) : null;
  const base = {
    _id: idString(entry._id),
    type: entry.type ?? 'STATUS_CHANGED',
    status: entry.status,
    ...(entry.priorityChange ? { priorityChange: { from: entry.priorityChange.from, to: entry.priorityChange.to } } : {}),
    ...(entry.publicNote ? { publicNote: entry.publicNote } : {}),
    actorLabel: !actor
      ? 'System'
      : actorId === String(viewer.userId) ? 'You' : (ACTOR_LABELS[actor.role] ?? 'System'),
    createdAt: entry.createdAt,
  };
  if (!staff) return base;
  return { ...base, ...(entry.internalNote ? { internalNote: entry.internalNote } : {}), actor };
};

const sortedTimeline = (complaint) => (complaint.statusHistory ?? [])
  .map((entry, index) => ({ entry, index }))
  .sort((a, b) => (new Date(a.entry.createdAt) - new Date(b.entry.createdAt)) || (a.index - b.index))
  .map(({ entry }) => entry);

const presentComplaint = (complaint, viewer, { identities = new Map() } = {}) => {
  const staff = authority.isStaff(viewer);
  const ownerView = {
    ...presentComplaintSummary(complaint, viewer),
    // The owner sees their own contact-free identity; staff see the reporter's.
    reporter: presentReporter(complaint),
    version: complaint.__v,
    images: (complaint.images ?? []).map((image) => ({ url: image.url })),
    ai: { summary: complaint.ai?.summary ?? '', tags: [...(complaint.ai?.tags ?? [])] },
    timeline: sortedTimeline(complaint).map((entry) => presentTimelineEntry(plain(entry), viewer, staff)),
    responsibility: complaint.assignedTo ? 'ASSIGNED' : 'AWAITING_ASSIGNMENT',
    canEdit: authority.canEdit(viewer, complaint),
    canWithdraw: authority.canWithdraw(viewer, complaint),
  };
  if (!staff) return ownerView;

  const ai = complaint.ai ?? {};
  return {
    ...ownerView,
    location: {
      address: complaint.location?.address ?? null,
      latitude: complaint.location?.latitude ?? null,
      longitude: complaint.location?.longitude ?? null,
      coordinateSource: complaint.location?.coordinateSource ?? null,
    },
    ai: {
      suggestedCategory: ai.suggestedCategory ?? null,
      confidence: ai.confidence ?? null,
      summary: ai.summary ?? '',
      tags: [...(ai.tags ?? [])],
      classifiedAt: ai.classifiedAt ?? null,
      error: ai.error ?? null,
      inputMode: ai.inputMode ?? null,
      analysisCount: ai.analysisCount ?? null,
    },
    assignee: presentAssignee(complaint),
    assignmentHistory: (complaint.assignmentHistory ?? []).map((raw) => {
      const entry = plain(raw);
      return {
        type: entry.type,
        previous: snapshotIdentity(entry.previous, identities),
        next: snapshotIdentity(entry.next, identities),
        changedBy: snapshotIdentity(entry.changedBy, identities),
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.migrationMarker ? { migrationMarker: entry.migrationMarker } : {}),
        createdAt: entry.createdAt,
      };
    }),
    editHistory: (complaint.editHistory ?? []).map((raw) => {
      const entry = plain(raw);
      return {
        editedAt: entry.editedAt,
        editedBy: snapshotIdentity(entry.editedBy, identities),
        fields: [...entry.fields],
        reanalysed: entry.reanalysed,
        ...(entry.aiError ? { aiError: entry.aiError } : {}),
      };
    }),
    allowedTransitions: authority.allowedTransitions(viewer, complaint),
    canChangePriority: authority.canChangePriority(viewer, complaint),
    canAssign: authority.canAssign(viewer, complaint),
    canDelete: authority.canDelete(viewer, complaint),
    resolvedAt: complaint.resolvedAt ?? null,
    resolvedAtEstimated: Boolean(complaint.resolvedAtEstimated),
  };
};

module.exports = {
  COMPLAINT_POPULATE,
  SUMMARY_POPULATE,
  loadPresentationIdentities,
  presentComplaint,
  presentComplaintSummary,
  viewerFromRequest,
};
