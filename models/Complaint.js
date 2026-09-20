const mongoose = require('mongoose');
const { PRIORITIES } = require('./Category');

const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
const ASSIGNMENT_EVENT_TYPES = [
    'ASSIGNED',
    'REASSIGNED',
    'UNASSIGNED',
    'RETIREMENT_UNASSIGNMENT',
    'LEGACY_STATE_IMPORT',
];

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

const statusHistorySchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: STATUSES,
            required: true,
        },
        note: {
            type: String,
            trim: true,
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
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
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            required: true,
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
    },
    { timestamps: true }
);

complaintSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });
complaintSchema.index({ reporter: 1, createdAt: -1 });
complaintSchema.index({ status: 1, priority: 1 });

module.exports = mongoose.model('Complaint', complaintSchema);
module.exports.STATUSES = STATUSES;
module.exports.ASSIGNMENT_EVENT_TYPES = ASSIGNMENT_EVENT_TYPES;
