const mongoose = require('mongoose');
const { PRIORITIES } = require('./Category');

const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'WITHDRAWN'];
const TIMELINE_TYPES = ['CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'WITHDRAWN'];
const ASSIGNMENT_EVENT_TYPES = [
    'ASSIGNED',
    'REASSIGNED',
    'UNASSIGNED',
    'RETIREMENT_UNASSIGNMENT',
    'LEGACY_STATE_IMPORT',
];

const historicalIdentitySnapshotSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        displayName: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            enum: ['citizen', 'admin', 'agency'],
        },
    },
    { _id: false }
);

const userSnapshotSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        displayName: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            enum: ['citizen', 'admin', 'agency'],
            required: true,
        },
    },
    { _id: false }
);

const assignmentHistorySchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ASSIGNMENT_EVENT_TYPES,
            required: true,
        },
        previous: {
            type: userSnapshotSchema,
            default: null,
        },
        next: {
            type: userSnapshotSchema,
            default: null,
        },
        changedBy: {
            type: userSnapshotSchema,
            default: null,
        },
        migrationMarker: {
            type: String,
            enum: ['PHASE_1_MIGRATION'],
        },
        reason: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        createdAt: {
            type: Date,
            required: true,
        },
    },
    { _id: false }
);

assignmentHistorySchema.pre('validate', function requireEventAuthor(next) {
    const hasActor = Boolean(this.changedBy);
    const hasMigrationMarker = Boolean(this.migrationMarker);
    if (hasActor === hasMigrationMarker) {
        this.invalidate('changedBy', 'Assignment history requires exactly one actor or migration marker');
    }
    next();
});

const priorityChangeSchema = new mongoose.Schema(
    {
        from: { type: String, enum: PRIORITIES, required: true },
        to: { type: String, enum: PRIORITIES, required: true },
    },
    { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: TIMELINE_TYPES,
            required: true,
            default: 'STATUS_CHANGED',
        },
        status: {
            type: String,
            enum: STATUSES,
            required: true,
        },
        priorityChange: {
            type: priorityChangeSchema,
            default: undefined,
        },
        publicNote: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        internalNote: {
            type: String,
            trim: true,
            maxlength: 1000,
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        changedBySnapshot: {
            type: historicalIdentitySnapshotSchema,
        },
        createdAt: {
            type: Date,
            default: Date.now,
            required: true,
        },
    },
    { _id: true }
);

const complaintSchema = new mongoose.Schema(
    {
        referenceCode: {
            type: String,
            required: true,
            unique: true,
        },
        description: {
            type: String,
            required: [true, 'Description is required'],
            trim: true,
            minlength: 10,
            maxlength: 2000,
        },
        images: {
            type: [{ url: { type: String, required: true }, publicId: { type: String, required: true }, _id: false }],
            default: [],
            validate: {
                validator: (val) => val.length <= 5,
                message: 'A report can have at most 5 photos',
            },
        },
        location: {
            address: { type: String, trim: true },
            latitude: { type: Number, min: -90, max: 90 },
            longitude: { type: Number, min: -180, max: 180 },
            coordinateSource: { type: String, enum: ['DEVICE', 'SUGGESTION'] },
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            required: true,
        },
        // The category as filed, so renames and deletions never rewrite history.
        categorySnapshot: {
            categoryId: { type: mongoose.Schema.Types.ObjectId },
            name: { type: String, trim: true },
        },
        status: {
            type: String,
            enum: STATUSES,
            default: 'PENDING',
        },
        priority: {
            type: String,
            enum: PRIORITIES,
            default: 'MEDIUM',
        },
        ai: {
            suggestedCategory: { type: String },
            confidence: { type: Number, min: 0, max: 1 },
            summary: { type: String, trim: true },
            tags: { type: [String], default: [] },
            classifiedAt: { type: Date },
            error: { type: String },
        },
        reporter: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        reporterSnapshot: {
            type: historicalIdentitySnapshotSchema,
        },
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        statusHistory: {
            type: [statusHistorySchema],
            default: [],
        },
        assignmentHistory: {
            type: [assignmentHistorySchema],
            default: [],
        },
        resolvedAt: {
            type: Date,
        },
        resolvedAtEstimated: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

complaintSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });
complaintSchema.index({ reporter: 1, createdAt: -1 });
complaintSchema.index({ status: 1, priority: 1 });

module.exports = mongoose.model('Complaint', complaintSchema);
module.exports.STATUSES = STATUSES;
module.exports.ASSIGNMENT_EVENT_TYPES = ASSIGNMENT_EVENT_TYPES;
module.exports.TIMELINE_TYPES = TIMELINE_TYPES;
