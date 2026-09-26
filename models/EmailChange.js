const mongoose = require('mongoose');

const ACTIVE_STATES = ['NOTICE_PENDING', 'NOTICE_SENT', 'LINK_SENT'];
const END_STATES = ['CONFIRMED', 'FAILED', 'SUPERSEDED', 'CANCELLED'];

// An email change moves NOTICE_PENDING -> NOTICE_SENT -> LINK_SENT -> CONFIRMED: the old address is
// told before the new one gets its link, and nothing changes until the link is used.
const emailChangeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  newEmail: { type: String, required: true, lowercase: true, trim: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  byAdministrator: { type: Boolean, default: false },
  state: { type: String, enum: [...ACTIVE_STATES, ...END_STATES], required: true },
  // Present (true) only while the change is under way; one active change per account.
  active: { type: Boolean },
  failedCode: { type: String, maxlength: 40 },
  endedAt: { type: Date },
}, { timestamps: true });

emailChangeSchema.index({ user: 1 }, { name: 'one_active_change_per_user', unique: true, partialFilterExpression: { active: true } });
emailChangeSchema.index({ user: 1, createdAt: -1 });
emailChangeSchema.index({ endedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports = mongoose.model('EmailChange', emailChangeSchema);
module.exports.ACTIVE_STATES = ACTIVE_STATES;
