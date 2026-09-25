const mongoose = require('mongoose');

// One-time links for password resets and email changes. Only the SHA-256 of the token is stored,
// so a copy of the database cannot be used to take over accounts.
const accountTokenSchema = new mongoose.Schema({
    purpose: { type: String, enum: ['password_reset', 'email_change'], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, match: /^[0-9a-f]{64}$/ },
    newEmail: { type: String, lowercase: true, trim: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
}, { timestamps: true });

// Removed once expired, used or not.
accountTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AccountToken', accountTokenSchema);
