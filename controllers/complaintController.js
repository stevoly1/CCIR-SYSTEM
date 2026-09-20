const fs = require('fs');
const mongoose = require('mongoose');
const { StatusCodes } = require('http-status-codes');
const { Complaint, Category, User } = require('../models');
const CustomError = require('../errors');
const { decideAssignment } = require('../policies/assignmentPolicy');
const { decideTransition } = require('../policies/complaintTransitionPolicy');
const { buildUserSnapshot, safeHistoricalIdentity } = require('../services/userSnapshotService');
const generateReferenceCode = require('../utils/referenceCode');
const aiService = require('../services/aiService');
const locationService = require('../services/locationService');
const uploadService = require('../services/uploadService');
const emailService = require('../services/emailService');

const STAFF_ROLES = ['admin', 'agency'];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Best-effort address/coordinate resolution — a geocoding hiccup should never block a
// citizen from filing a report, so every branch here degrades to whatever the client sent.
const resolveLocation = async ({ latitude, longitude, address }) => {
    try {
        if (latitude !== undefined && longitude !== undefined) {
            const resolvedAddress = address || (await locationService.reverseGeocode(latitude, longitude));
            return { latitude, longitude, address: resolvedAddress || address };
        }
        if (address) {
            const resolved = await locationService.geocodeAddress(address);
            return resolved;
        }
    } catch (error) {
        console.error('Location resolution failed, falling back to raw input:', error.message);
    }
    return { latitude, longitude, address };
};

const cleanupTempFile = (tempFilePath) => {
    if (!tempFilePath) return;
    fs.unlink(tempFilePath, () => {});
};

const MAX_IMAGES = 5;

const assignmentIdentityIds = (complaints) => complaints.flatMap((complaint) =>
    complaint.assignmentHistory.flatMap((entry) => [
        entry.previous?.userId,
        entry.next?.userId,
        entry.changedBy?.userId,
    ].filter(Boolean))
);

const loadAssignmentIdentityMap = async (complaints) => {
    const ids = assignmentIdentityIds(complaints);
    if (ids.length === 0) return new Map();
    const users = await User.find({ _id: { $in: ids } }).select('name role isActive retiredAt');
    return new Map(users.map((user) => [user._id.toString(), user]));
};

const shapeAssignmentSnapshot = (snapshot, identityById) => {
    if (!snapshot) return null;
    return safeHistoricalIdentity({
        populatedUser: identityById.get(snapshot.userId.toString()),
        snapshot,
    });
};

const shapeHistoricalComplaint = (complaint, assignmentIdentityById = new Map()) => {
    const shaped = complaint.toObject();
    shaped.reporter = safeHistoricalIdentity({
        populatedUser: complaint.reporter,
        snapshot: complaint.reporterSnapshot,
    });
    shaped.statusHistory = complaint.statusHistory.map((entry) => {
        const value = entry.toObject();
        value.changedBy = safeHistoricalIdentity({
            populatedUser: entry.changedBy,
            snapshot: entry.changedBySnapshot,
        });
        delete value.changedBySnapshot;
        return value;
    });
    shaped.assignmentHistory = complaint.assignmentHistory.map((entry) => {
        const value = entry.toObject();
        value.previous = shapeAssignmentSnapshot(entry.previous, assignmentIdentityById);
        value.next = shapeAssignmentSnapshot(entry.next, assignmentIdentityById);
        value.changedBy = shapeAssignmentSnapshot(entry.changedBy, assignmentIdentityById);
        return value;
    });
    delete shaped.reporterSnapshot;
    return shaped;
};

const createComplaint = async (req, res) => {
    const { description, categoryId, address, latitude, longitude } = req.body;
    const rawFiles = req.files?.image;
    const imageFiles = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []).slice(0, MAX_IMAGES);

    const [location, activeCategories] = await Promise.all([
        resolveLocation({ latitude, longitude, address }),
        Category.find({ isActive: true }),
    ]);

    const ai = await aiService.classifyComplaint({
        description,
        imageTempFilePath: imageFiles[0]?.tempFilePath,
        imageMimeType: imageFiles[0]?.mimetype,
        categoryNames: activeCategories.map((c) => c.name),
    });

    let category = null;
    if (categoryId) {
        category = await Category.findById(categoryId);
    }
    if (!category) {
        category = activeCategories.find((c) => c.name.toLowerCase() === ai.category?.toLowerCase());
    }
    if (!category) {
        category = activeCategories.find((c) => c.name === 'Other');
    }
    if (!category) {
        throw new CustomError.BadRequestError('No category could be determined for this complaint');
    }

    let images = [];
    if (imageFiles.length) {
        try {
            images = await Promise.all(imageFiles.map((file) => uploadService.uploadComplaintImage(file.tempFilePath)));
        } finally {
            imageFiles.forEach((file) => cleanupTempFile(file.tempFilePath));
        }
    }

    const reporter = await User.findById(req.user.userId);
    if (!reporter) throw new CustomError.UnauthenticatedError('Not authenticated');
    const reporterSnapshot = buildUserSnapshot(reporter);

    const complaint = await Complaint.create({
        referenceCode: generateReferenceCode(),
        description,
        images,
        location,
        category: category._id,
        priority: ai.error ? category.defaultPriority : ai.priority,
        ai: {
            suggestedCategory: ai.category,
            confidence: ai.confidence,
            summary: ai.summary,
            tags: ai.tags,
            classifiedAt: new Date(),
            error: ai.error,
        },
        reporter: req.user.userId,
        reporterSnapshot,
        statusHistory: [{
            status: 'PENDING',
            note: 'Report submitted',
            changedBy: req.user.userId,
            changedBySnapshot: reporterSnapshot,
        }],
    });

    await complaint.populate([
        'category',
        { path: 'reporter', select: 'name email role isActive retiredAt' },
        { path: 'statusHistory.changedBy', select: 'name role isActive retiredAt' },
    ]);

    emailService.sendComplaintFiledEmail({
        to: complaint.reporter.email,
        name: complaint.reporter.name,
        referenceCode: complaint.referenceCode,
        complaintId: complaint._id,
    });

    res.status(StatusCodes.CREATED).json({ complaint: shapeHistoricalComplaint(complaint) });
};

const getAllComplaints = async (req, res) => {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const filter = {};
    if (!STAFF_ROLES.includes(req.user.role)) {
        filter.reporter = req.user.userId;
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;
    if (req.query.search) {
        const regex = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
        filter.$or = [
            { referenceCode: regex },
            { description: regex },
            { 'location.address': regex },
        ];
    }

    const [complaints, total] = await Promise.all([
        Complaint.find(filter)
            .populate('category', 'name')
            .populate('reporter', 'name role isActive retiredAt')
            .populate('assignedTo', 'name role isActive retiredAt')
            .populate('statusHistory.changedBy', 'name role isActive retiredAt')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        Complaint.countDocuments(filter),
    ]);

    const assignmentIdentityById = await loadAssignmentIdentityMap(complaints);
    res.status(StatusCodes.OK).json({
        complaints: complaints.map((complaint) => shapeHistoricalComplaint(complaint, assignmentIdentityById)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
};

const getSingleComplaint = async (req, res) => {
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    const isOwner = complaint.reporter.toString() === req.user.userId;
    if (!isOwner && !STAFF_ROLES.includes(req.user.role)) {
        throw new CustomError.ForbiddenError('You do not have access to this complaint');
    }

    await complaint.populate([
        'category',
        { path: 'reporter', select: 'name role isActive retiredAt' },
        { path: 'assignedTo', select: 'name role isActive retiredAt' },
        { path: 'statusHistory.changedBy', select: 'name role isActive retiredAt' },
    ]);

    const assignmentIdentityById = await loadAssignmentIdentityMap([complaint]);

    res.status(StatusCodes.OK).json({ complaint: shapeHistoricalComplaint(complaint, assignmentIdentityById) });
};

const updateComplaint = async (req, res) => {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    if (complaint.reporter.toString() !== req.user.userId) {
        throw new CustomError.ForbiddenError('You do not have access to this complaint');
    }
    if (complaint.status !== 'PENDING') {
        throw new CustomError.BadRequestError('This report can no longer be edited because it is already being processed');
    }

    const { description, address, latitude, longitude } = req.body;
    if (description) complaint.description = description;
    if (address || latitude !== undefined || longitude !== undefined) {
        complaint.location = await resolveLocation({
            latitude: latitude ?? complaint.location?.latitude,
            longitude: longitude ?? complaint.location?.longitude,
            address: address || complaint.location?.address,
        });
    }

    await complaint.save();
    res.status(StatusCodes.OK).json({ complaint });
};

const updateComplaintStatus = async (req, res) => {
    const { status, note, priority } = req.body;

    const [complaint, actor] = await Promise.all([
        Complaint.findById(req.params.id),
        User.findById(req.user.userId),
    ]);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);
    if (!actor) throw new CustomError.UnauthenticatedError('Not authenticated');

    const decision = decideTransition({
        from: complaint.status,
        to: status,
        reason: note,
        priority,
        now: new Date(),
    });

    const update = {
        $set: { status: decision.status },
        $push: {
            statusHistory: {
                ...decision.historyEntry,
                changedBy: req.user.userId,
                changedBySnapshot: buildUserSnapshot(actor),
            },
        },
        $inc: { __v: 1 },
    };
    if (decision.priority !== undefined) update.$set.priority = decision.priority;
    if (decision.resolvedAtAction === 'set') update.$set.resolvedAt = decision.historyEntry.createdAt;
    if (decision.resolvedAtAction === 'clear') update.$unset = { resolvedAt: 1 };

    const updated = await Complaint.findOneAndUpdate(
        { _id: complaint._id, status: complaint.status, __v: complaint.__v },
        update,
        { new: true, runValidators: true }
    ).populate([
        'category',
        { path: 'reporter', select: 'name email role isActive retiredAt' },
        { path: 'assignedTo', select: 'name role isActive retiredAt' },
        { path: 'statusHistory.changedBy', select: 'name role isActive retiredAt' },
    ]);

    if (!updated) {
        throw new CustomError.ConflictError('Complaint status changed concurrently; reload and retry');
    }

    emailService.sendStatusUpdateEmail({
        to: updated.reporter.email,
        name: updated.reporter.name,
        referenceCode: updated.referenceCode,
        status: updated.status,
        note,
        complaintId: updated._id,
    });

    const assignmentIdentityById = await loadAssignmentIdentityMap([updated]);
    res.status(StatusCodes.OK).json({ complaint: shapeHistoricalComplaint(updated, assignmentIdentityById) });
};

const assignComplaint = async (req, res) => {
    const { assignedTo, reason } = req.body;

    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
        throw new CustomError.BadRequestError('Invalid complaint id');
    }

    const complaint = await Complaint.findById(req.params.id).populate('assignedTo');
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    const [actor, target] = await Promise.all([
        User.findById(req.user.userId),
        assignedTo === null ? null : User.findById(assignedTo),
    ]);

    if (assignedTo !== null && !target) {
        throw new CustomError.NotFoundError(`No user found with id ${assignedTo}`);
    }

    const originalAssignee = complaint.assignedTo;
    if (assignedTo === null && !originalAssignee) {
        throw new CustomError.ConflictError('Complaint is already unassigned');
    }

    const decision = decideAssignment({
        actor,
        target,
        currentAssignee: originalAssignee,
        reason,
    });

    const updated = await Complaint.findOneAndUpdate(
        {
            _id: complaint._id,
            assignedTo: originalAssignee?._id ?? null,
            __v: complaint.__v,
        },
        {
            $set: { assignedTo: decision.assignedTo },
            $push: { assignmentHistory: decision.event },
            $inc: { __v: 1 },
        },
        { new: true, runValidators: true }
    ).populate([
        'category',
        { path: 'reporter', select: 'name role isActive retiredAt' },
        { path: 'assignedTo', select: 'name role isActive retiredAt' },
        { path: 'statusHistory.changedBy', select: 'name role isActive retiredAt' },
    ]);

    if (!updated) {
        throw new CustomError.ConflictError('Complaint assignment changed concurrently; reload and retry');
    }

    const assignmentIdentityById = await loadAssignmentIdentityMap([updated]);
    res.status(StatusCodes.OK).json({ complaint: shapeHistoricalComplaint(updated, assignmentIdentityById) });
};

const deleteComplaint = async (req, res) => {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    const isOwner = complaint.reporter.toString() === req.user.userId;
    if (!isOwner && !STAFF_ROLES.includes(req.user.role)) {
        throw new CustomError.ForbiddenError('You do not have access to this complaint');
    }
    if (isOwner && !STAFF_ROLES.includes(req.user.role) && complaint.status !== 'PENDING') {
        throw new CustomError.BadRequestError('This report can no longer be deleted because it is already being processed');
    }

    await uploadService.deleteComplaintImages(complaint.images.map((img) => img.publicId));
    await complaint.deleteOne();

    res.status(StatusCodes.OK).json({ msg: 'Complaint deleted' });
};

module.exports = {
    createComplaint,
    getAllComplaints,
    getSingleComplaint,
    updateComplaint,
    updateComplaintStatus,
    assignComplaint,
    deleteComplaint,
};
