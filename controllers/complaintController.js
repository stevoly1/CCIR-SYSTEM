const mongoose = require('mongoose');
const { StatusCodes } = require('http-status-codes');
const { Complaint, Category, User } = require('../models');
const CustomError = require('../errors');
const { decideTransition, decidePriorityChange } = require('../policies/complaintTransitionPolicy');
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
const { chooseCategory } = require('../policies/complaintCategoryPolicy');
const { categoryInactive, complaintWithdrawn, emailNotVerified } = require('../errors/domainErrors');
const { versionFilter } = require('../services/complaintVersionGuard');
const { notAssignedToYou, staleComplaint } = require('../errors/domainErrors');
const referenceService = require('../services/complaintReferenceService');
const aiService = require('../services/aiService');
const { inTransaction } = require('../utils/transaction');
const { enqueue } = require('../services/jobs/outbox');
const complaintImageService = require('../services/complaintImageService');
// Module-object access keeps the edit service replaceable in tests.
const complaintEditService = require('../services/complaintEditService');
const { assignComplaintTransaction } = require('../services/complaintAssignmentService');
const { deleteComplaintPermanently } = require('../services/complaintDeletionService');

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
        // First, so an unverified account costs no image work or provider call.
        const reporter = await User.findById(req.user.userId);
        if (!reporter) throw new CustomError.UnauthenticatedError('Not authenticated');
        if (reporter.authProvider === 'local' && !reporter.emailVerifiedAt) throw emailNotVerified();

        // A client category hint must name an existing, active category; checked before
        // any image work or provider call so a rejected hint costs nothing.
        let hint = null;
        if (categoryId) {
            hint = await Category.findOne({ _id: categoryId, isActive: true });
            if (!hint) throw categoryInactive();
        }

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

        const category = chooseCategory({ ai, activeCategories, hint });

        const reporterSnapshot = buildUserSnapshot(reporter);
        const images = await complaintImageService.uploadComplaintImages(imageFiles);

        let complaint;
        try {
            // A reference-code collision retries only this insert; uploads and AI are not repeated.
            // The report and its filed email are written together, or neither is.
            complaint = await referenceService.createWithUniqueReference((referenceCode) => inTransaction(async (session) => {
                const [created] = await Complaint.create([{
                    referenceCode,
                    description,
                    images,
                    location,
                    category: category._id,
                    categorySnapshot: { categoryId: category._id, name: category.name },
                    priority: ai.error ? category.defaultPriority : ai.priority,
                    prioritySource: ai.error ? 'CATEGORY_DEFAULT' : 'AI',
                    ai: {
                        suggestedCategory: ai.category,
                        confidence: ai.confidence,
                        summary: ai.summary,
                        tags: ai.tags,
                        classifiedAt: new Date(),
                        error: ai.error,
                        inputMode: imageFiles.length ? 'TEXT_AND_IMAGE' : 'TEXT_ONLY',
                        analysisCount: 1,
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
                }], { session });
                await enqueue(session, { queue: 'email', type: 'report_filed', refs: { complaintId: String(created._id) } });
                return created;
            }));
        } catch (error) {
            await complaintImageService.cleanupCloudImages(images);
            throw error;
        }

        await respondWithComplaint(res, StatusCodes.CREATED, complaint._id, viewerFromRequest(req));
    } finally {
        await complaintImageService.cleanupTemporaryFiles([...requestFiles, ...imageFiles]);
    }
};

const getAllComplaints = async (req, res) => {
    const { page, limit, sort } = req.query;
    const viewer = viewerFromRequest(req);
    // Citizens may not probe which staff member handles their complaints.
    if (req.query.assignedTo && !authority.isStaff(viewer)) {
        throw new CustomError.ForbiddenError('You do not have permission to filter by assignee');
    }

    const filter = {};
    if (!authority.isStaff(viewer)) {
        filter.reporter = req.user.userId;
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo === 'none' ? null : req.query.assignedTo;
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
    const viewer = viewerFromRequest(req);
    const { complaint, reanalysed } = await complaintEditService.editComplaint({
        complaintId: req.params.id,
        viewer,
        changes: req.body,
    });
    const populated = await Complaint.findById(complaint._id).populate(COMPLAINT_POPULATE);
    const identities = await loadPresentationIdentities([populated]);
    res.status(StatusCodes.OK).json({ complaint: presentComplaint(populated, viewer, { identities }), reanalysed });
};

// Staff status and/or priority update. Agency authority is checked against the current
// assignee both before the write and inside its filter, so a reassignment mid-request
// cannot slip through.
const updateComplaintStatus = async (req, res) => {
    const { status, publicNote, internalNote, priority, expectedVersion } = req.body;
    const viewer = viewerFromRequest(req);

    const [complaint, actor] = await Promise.all([
        Complaint.findById(req.params.id),
        User.findById(req.user.userId),
    ]);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);
    if (!actor) throw new CustomError.UnauthenticatedError('Not authenticated');
    if (!authority.canManageStatus(viewer, complaint)) throw notAssignedToYou();
    // A priority-only change must honour the same rule the presenter reports; the status
    // pinned in the write filter below still catches a withdrawal that races this request.
    if (status === undefined && !authority.canChangePriority(viewer, complaint)) throw complaintWithdrawn();
    const matchVersion = versionFilter(complaint, expectedVersion);
    const now = new Date();

    const decision = status !== undefined
        ? decideTransition({
            from: complaint.status,
            to: status,
            publicNote,
            internalNote,
            priority,
            currentPriority: complaint.priority,
            now,
        })
        : decidePriorityChange({
            status: complaint.status,
            currentPriority: complaint.priority,
            priority,
            publicNote,
            internalNote,
            now,
        });

    const historyEntryId = new mongoose.Types.ObjectId();
    const update = {
        $set: {},
        $push: {
            statusHistory: {
                _id: historyEntryId,
                ...decision.historyEntry,
                changedBy: actor._id,
                changedBySnapshot: buildUserSnapshot(actor),
            },
        },
        $inc: { __v: 1 },
    };
    if (decision.status !== undefined) update.$set.status = decision.status;
    if (decision.historyEntry.priorityChange) {
        update.$set.priority = decision.historyEntry.priorityChange.to;
        update.$set.prioritySource = 'STAFF';
    }
    if (decision.resolvedAtAction === 'set') {
        update.$set.resolvedAt = decision.historyEntry.createdAt;
        update.$set.resolvedAtEstimated = false;
    }
    if (decision.resolvedAtAction === 'clear') {
        update.$set.resolvedAtEstimated = false;
        update.$unset = { resolvedAt: 1 };
    }

    const filter = { _id: complaint._id, status: complaint.status, __v: matchVersion };
    if (viewer.role === 'agency') filter.assignedTo = complaint.assignedTo;
    // The change and its email to the reporter are written together. Only status changes notify
    // the reporter, and the email only ever carries the public note.
    const updated = await inTransaction(async (session) => {
        const result = await Complaint.findOneAndUpdate(filter, update, { returnDocument: 'after', runValidators: true, session });
        if (result && decision.status !== undefined && result.reporter) {
            await enqueue(session, { queue: 'email', type: 'status_update', refs: { complaintId: String(result._id), historyEntryId: String(historyEntryId) } });
        }
        return result;
    });

    if (!updated) {
        const current = await Complaint.findById(complaint._id).select('assignedTo');
        if (viewer.role === 'agency' && String(current?.assignedTo) !== viewer.userId) throw notAssignedToYou();
        throw staleComplaint();
    }

    await respondWithComplaint(res, StatusCodes.OK, updated._id, viewer);
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

const withdrawComplaint = async (req, res) => {
    const viewer = viewerFromRequest(req);
    const complaint = await complaintEditService.withdrawComplaint({
        complaintId: req.params.id,
        viewer,
        reason: req.body.reason,
        expectedVersion: req.body.expectedVersion,
    });
    await respondWithComplaint(res, StatusCodes.OK, complaint._id, viewer);
};

// Administrator-only (route-restricted); citizens withdraw instead.
const deleteComplaint = async (req, res) => {
    await deleteComplaintPermanently({
        complaintId: req.params.id,
        viewer: viewerFromRequest(req),
        reason: req.body.reason,
        expectedVersion: req.body.expectedVersion,
    });
    res.status(StatusCodes.OK).json({ msg: 'Complaint deleted' });
};

module.exports = {
    createComplaint,
    getAllComplaints,
    getSingleComplaint,
    updateComplaint,
    updateComplaintStatus,
    assignComplaint,
    withdrawComplaint,
    deleteComplaint,
};
