const fs = require('fs');
const { StatusCodes } = require('http-status-codes');
const { Complaint, Category } = require('../models');
const CustomError = require('../errors');
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
        statusHistory: [{ status: 'PENDING', note: 'Report submitted', changedBy: req.user.userId }],
    });

    await complaint.populate(['category', 'reporter']);

    emailService.sendComplaintFiledEmail({
        to: complaint.reporter.email,
        name: complaint.reporter.name,
        referenceCode: complaint.referenceCode,
        complaintId: complaint._id,
    });

    res.status(StatusCodes.CREATED).json({ complaint });
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
            .populate('reporter', 'name email')
            .populate('assignedTo', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        Complaint.countDocuments(filter),
    ]);

    res.status(StatusCodes.OK).json({
        complaints,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
};

const getSingleComplaint = async (req, res) => {
    const complaint = await Complaint.findById(req.params.id)
        .populate('category')
        .populate('reporter', 'name email phone')
        .populate('assignedTo', 'name email')
        .populate('statusHistory.changedBy', 'name role');

    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    const isOwner = complaint.reporter._id.toString() === req.user.userId;
    if (!isOwner && !STAFF_ROLES.includes(req.user.role)) {
        throw new CustomError.ForbiddenError('You do not have access to this complaint');
    }

    res.status(StatusCodes.OK).json({ complaint });
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

    const complaint = await Complaint.findById(req.params.id).populate('reporter', 'name email');
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    complaint.status = status;
    if (priority) complaint.priority = priority;
    if (status === 'RESOLVED') complaint.resolvedAt = new Date();
    complaint.statusHistory.push({ status, note, changedBy: req.user.userId });

    await complaint.save();
    await complaint.populate(['category', 'assignedTo']);

    emailService.sendStatusUpdateEmail({
        to: complaint.reporter.email,
        name: complaint.reporter.name,
        referenceCode: complaint.referenceCode,
        status: complaint.status,
        note,
        complaintId: complaint._id,
    });

    res.status(StatusCodes.OK).json({ complaint });
};

const assignComplaint = async (req, res) => {
    const { assignedTo } = req.body;

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) throw new CustomError.NotFoundError(`No complaint found with id ${req.params.id}`);

    complaint.assignedTo = assignedTo;
    const statusChanged = complaint.status === 'PENDING';
    if (statusChanged) {
        complaint.status = 'IN_REVIEW';
        complaint.statusHistory.push({ status: 'IN_REVIEW', note: 'Assigned for review', changedBy: req.user.userId });
    }

    await complaint.save();
    await complaint.populate(['category', 'reporter', 'assignedTo']);

    if (statusChanged) {
        emailService.sendStatusUpdateEmail({
            to: complaint.reporter.email,
            name: complaint.reporter.name,
            referenceCode: complaint.referenceCode,
            status: complaint.status,
            note: 'Assigned for review',
            complaintId: complaint._id,
        });
    }

    res.status(StatusCodes.OK).json({ complaint });
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
