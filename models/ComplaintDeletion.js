const mongoose = require('mongoose');
const { STATUSES } = require('./Complaint');

// Audit record of an administrator's permanent deletion. Deliberately holds no
// complaint content (description, location, images) — only who, what, when, and why.
const complaintDeletionSchema = new mongoose.Schema({
    // A complaint is deleted once, so it has at most one record.
    complaintId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    referenceCode: { type: String, required: true },
    statusAtDeletion: { type: String, enum: STATUSES, required: true },
    reporterId: { type: mongoose.Schema.Types.ObjectId },
    deletedBy: {
        type: new mongoose.Schema({
            userId: { type: mongoose.Schema.Types.ObjectId, required: true },
            displayName: { type: String, required: true },
            role: { type: String, enum: ['admin'], required: true },
        }, { _id: false }),
        required: true,
    },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    deletedAt: { type: Date, required: true },
});

module.exports = mongoose.model('ComplaintDeletion', complaintDeletionSchema);
