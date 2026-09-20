const mongoose = require('mongoose');

const authThrottleSchema = new mongoose.Schema({
  _id: { type: String },
  count: { type: Number, required: true, min: 1 },
  resetAt: { type: Date, required: true },
}, { versionKey: false });

authThrottleSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthThrottle', authThrottleSchema);
