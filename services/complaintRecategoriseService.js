const { Category, Complaint, User } = require('../models');
const CustomError = require('../errors');
const authority = require('../policies/complaintAuthorityPolicy');
const { assertExpectedVersion } = require('./complaintVersionGuard');
const { buildUserSnapshot } = require('./userSnapshotService');
const { categoryInactive, categoryUnchanged, complaintWithdrawn, notAssignedToYou, staleComplaint } = require('../errors/domainErrors');
const { getLogger } = require('../utils/logger');

const refuseUnlessAllowed = (viewer, complaint) => {
  if (!authority.canManageStatus(viewer, complaint)) {
    throw viewer.role === 'agency' ? notAssignedToYou() : new CustomError.ForbiddenError('You may not change this report\'s category');
  }
  if (complaint.status === 'WITHDRAWN') throw complaintWithdrawn();
};

// Choosing the current category is useful only to resolve a disagreement with the citizen's choice.
const recategorise = async ({ complaintId, viewer, categoryId, reason, expectedVersion }) => {
  const complaint = await Complaint.findById(complaintId);
  if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${complaintId}`);
  refuseUnlessAllowed(viewer, complaint);
  assertExpectedVersion(complaint, expectedVersion);
  const category = await Category.findOne({ _id: categoryId, isActive: true });
  if (!category) throw categoryInactive();
  if (String(category._id) === String(complaint.category) && !complaint.ai?.disagreement?.categoryId) throw categoryUnchanged();

  const actor = await User.findById(viewer.userId);
  const actorSnapshot = buildUserSnapshot(actor);
  const from = { categoryId: complaint.categorySnapshot?.categoryId ?? complaint.category, name: complaint.categorySnapshot?.name };
  const updated = await Complaint.findOneAndUpdate(
    {
      _id: complaint._id, __v: complaint.__v, status: { $ne: 'WITHDRAWN' },
      ...(viewer.role === 'agency' ? { assignedTo: viewer.userId } : {}),
    },
    {
      $set: { category: category._id, categorySnapshot: { categoryId: category._id, name: category.name }, categorySource: 'STAFF' },
      $unset: { 'ai.disagreement': 1 },
      $push: {
        statusHistory: {
          type: 'CATEGORY_CHANGED', status: complaint.status, categoryChange: { from, to: { categoryId: category._id, name: category.name } },
          internalNote: reason, changedBy: actor._id, changedBySnapshot: actorSnapshot, createdAt: new Date(),
        },
      },
      $inc: { __v: 1 },
    },
    { returnDocument: 'after', runValidators: true },
  );
  if (!updated) {
    const current = await Complaint.findById(complaint._id).select('status assignedTo');
    if (!current) throw new CustomError.NotFoundError(`No complaint found with id ${complaintId}`);
    refuseUnlessAllowed(viewer, current);
    throw staleComplaint();
  }
  getLogger().info({ event: 'category_changed', complaintId: String(complaint._id), by: String(viewer.userId) }, 'Report category changed by staff');
  return updated;
};

module.exports = { recategorise };
