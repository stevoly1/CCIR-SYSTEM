const { StatusCodes } = require('http-status-codes');
const { Complaint, Category, User } = require('../models');
const CustomError = require('../errors');
const { decideTransition } = require('../policies/complaintTransitionPolicy');
const authority = require('../policies/complaintAuthorityPolicy');
const {
    COMPLAINT_POPULATE,
    SUMMARY_POPULATE,
    loadPresentationIdentities,
    presentComplaint,
    presentComplaintSummary,
    viewerFromRequest,
} = require('../presenters/complaintPresenter');
const { buildUserSnapshot } = require('../services/userSnapshotService');
const { buildLocation } = require('../validators/locationValidator');
const { versionFilter } = require('../services/complaintVersionGuard');
const { staleComplaint } = require('../errors/domainErrors');
const generateReferenceCode = require('../utils/referenceCode');
const aiService = require('../services/aiService');
const uploadService = require('../services/uploadService');
const emailService = require('../services/emailService');
const complaintImageService = require('../services/complaintImageService');
const { assignComplaintTransaction } = require('../services/complaintAssignmentService');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every complaint detail response is re-read, populated, and shaped by the presenter.
const respondWithComplaint = async (res, statusCode, complaintId, viewer) => {
    const complaint = await Complaint.findById(complaintId).populate(COMPLAINT_POPULATE);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${complaintId}`);
    const identities = await loadPresentationIdentities([complaint]);
    res.status(statusCode).json({ complaint: presentComplaint(complaint, viewer, { identities }) });
};

const createComplaint = async (req, res) => {
    const { description, categoryId } = req.body;
    const location = buildLocation(req.body);
    const requestFiles = Object.values(req.files || {}).flatMap((value) => (
        Array.isArray(value) ? value : [value]
    ));

    let imageFiles = [];
    try {
        const unexpectedFields = Object.keys(req.files || {}).filter((field) => field !== 'image');
        if (unexpectedFields.length > 0) {
            throw new CustomError.UnsupportedMediaTypeError('Only the image upload field is supported');
        }
        imageFiles = await complaintImageService.prepareComplaintImages(req.files?.image);

        const activeCategories = await Category.find({ isActive: true });
        const fallbackCategory = activeCategories.find((category) => category.name === 'Other');
        if (!fallbackCategory) {
            throw new Error('Active Other category is not configured');
        }

        const ai = await aiService.classifyComplaint({
            description,
            imageTempFilePath: imageFiles[0]?.tempFilePath,
            imageMimeType: imageFiles[0]?.mimeType,
            categoryNames: activeCategories.map((c) => c.name),
        });

        let category = ai.error ? fallbackCategory : null;
        if (!category && categoryId) {
            category = await Category.findById(categoryId);
        }
        if (!category) {
            category = activeCategories.find((c) => c.name.toLowerCase() === ai.category?.toLowerCase());
        }
        if (!category) category = fallbackCategory;

        const reporter = await User.findById(req.user.userId);
        if (!reporter) throw new CustomError.UnauthenticatedError('Not authenticated');
        const reporterSnapshot = buildUserSnapshot(reporter);
        const images = await complaintImageService.uploadComplaintImages(imageFiles);

        let complaint;
        try {
            complaint = await Complaint.create({
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
                    type: 'CREATED',
                    status: 'PENDING',
                    publicNote: 'Report submitted',
                    changedBy: req.user.userId,
                    changedBySnapshot: reporterSnapshot,
                }],
            });
        } catch (error) {
            await complaintImageService.cleanupCloudImages(images);
            throw error;
        }

        emailService.sendComplaintFiledEmail({
            to: reporter.email,
            name: reporter.name,
            referenceCode: complaint.referenceCode,
            complaintId: complaint._id,
        });

        await respondWithComplaint(res, StatusCodes.CREATED, complaint._id, viewerFromRequest(req));
    } finally {
        await complaintImageService.cleanupTemporaryFiles([...requestFiles, ...imageFiles]);
    }
};

const getAllComplaints = async (req, res) => {
    const { page, limit, sort } = req.query;
    const viewer = viewerFromRequest(req);

    const filter = {};
    if (!authority.isStaff(viewer)) {
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
            .populate(SUMMARY_POPULATE)
            .sort({ createdAt: sort === 'oldest' ? 1 : -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        Complaint.countDocuments(filter),
    ]);

    res.status(StatusCodes.OK).json({
        complaints: complaints.map((complaint) => presentComplaintSummary(complaint, viewer)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
};

const getSingleComplaint = async (req, res) => {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    const viewer = viewerFromRequest(req);
    if (!authority.canViewComplaint(viewer, complaint)) {
        throw new CustomError.ForbiddenError('You do not have access to this complaint');
    }

    await respondWithComplaint(res, StatusCodes.OK, complaint._id, viewer);
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

    // Task 13 replaces this handler with guarded, re-analysing edits.
    const { description, location } = req.body;
    if (description) complaint.description = description;
    if (location) complaint.location = buildLocation(location);

    await complaint.save();
    await respondWithComplaint(res, StatusCodes.OK, complaint._id, viewerFromRequest(req));
};

const updateComplaintStatus = async (req, res) => {
    const { status, publicNote, internalNote, priority, expectedVersion } = req.body;

    const [complaint, actor] = await Promise.all([
        Complaint.findById(req.params.id),
        User.findById(req.user.userId),
    ]);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);
    if (!actor) throw new CustomError.UnauthenticatedError('Not authenticated');
    const matchVersion = versionFilter(complaint, expectedVersion);

    const decision = decideTransition({
        from: complaint.status,
        to: status,
        publicNote,
        internalNote,
        priority,
        currentPriority: complaint.priority,
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
    if (decision.resolvedAtAction === 'set') {
        update.$set.resolvedAt = decision.historyEntry.createdAt;
        update.$set.resolvedAtEstimated = false;
    }
    if (decision.resolvedAtAction === 'clear') {
        update.$set.resolvedAtEstimated = false;
        update.$unset = { resolvedAt: 1 };
    }

    const updated = await Complaint.findOneAndUpdate(
        { _id: complaint._id, status: complaint.status, __v: matchVersion },
        update,
        { new: true, runValidators: true }
    ).populate({ path: 'reporter', select: 'name email' });

    if (!updated) throw staleComplaint();

    if (updated.reporter) {
        emailService.sendStatusUpdateEmail({
            to: updated.reporter.email,
            name: updated.reporter.name,
            referenceCode: updated.referenceCode,
            status: updated.status,
            publicNote: decision.historyEntry.publicNote,
            complaintId: updated._id,
        });
    }

    await respondWithComplaint(res, StatusCodes.OK, updated._id, viewerFromRequest(req));
};

const assignComplaint = async (req, res) => {
    const { assignedTo, reason, expectedVersion } = req.body;
    const updated = await assignComplaintTransaction({
        complaintId: req.params.id,
        actorUserId: req.user.userId,
        assignedTo,
        reason,
        expectedVersion,
    });
    await respondWithComplaint(res, StatusCodes.OK, updated._id, viewerFromRequest(req));
};

const deleteComplaint = async (req, res) => {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    const viewer = viewerFromRequest(req);
    const isOwner = authority.isReporter(viewer, complaint);
    const isStaff = authority.isStaff(viewer);
    if (!isOwner && !isStaff) {
        throw new CustomError.ForbiddenError('You do not have access to this complaint');
    }
    if (isOwner && !isStaff && complaint.status !== 'PENDING') {
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
