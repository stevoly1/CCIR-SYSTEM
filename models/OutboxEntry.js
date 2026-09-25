const mongoose = require('mongoose');

// A job, written in the same transaction as the change it belongs to; the queue carries only its id.
// refs hold ids only (the forgot-password entry's address is the one exception, removed when done).
const outboxEntrySchema = new mongoose.Schema({
  queue: { type: String, enum: ['ai', 'email'], required: true },
  type: { type: String, required: true, maxlength: 60 },
  refs: { type: mongoose.Schema.Types.Mixed, default: {} },
  state: { type: String, enum: ['PENDING', 'QUEUED', 'DONE', 'FAILED', 'DISMISSED'], default: 'PENDING', required: true },
  runKey: { type: Number, default: 0, min: 0 },
  attempts: { type: Number, default: 0, min: 0 },
  lastErrorCode: { type: String, maxlength: 40 },
  lastErrorAt: { type: Date },
  queuedAt: { type: Date },
  deliveredAt: { type: Date },
  doneAt: { type: Date },
  dismissedAt: { type: Date },
  dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  dismissReason: { type: String, trim: true, maxlength: 500 },
}, { timestamps: true, minimize: false });

outboxEntrySchema.index({ state: 1, createdAt: 1 });
outboxEntrySchema.index({ queue: 1, state: 1, lastErrorAt: -1 });
outboxEntrySchema.index({ doneAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
outboxEntrySchema.index({ dismissedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports = mongoose.model('OutboxEntry', outboxEntrySchema);
