const mongoose = require('mongoose');
const { PRIORITIES } = require('./Category');

const STATUSES = ['PENDING', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];

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
    },
    { timestamps: { createdAt: true, updatedAt: false } }
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
