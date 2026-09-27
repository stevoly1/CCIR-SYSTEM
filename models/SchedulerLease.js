const mongoose = require('mongoose');

// One document per scheduled task. Only the process that moves nextRunAt may run it.
const schedulerLeaseSchema = new mongoose.Schema({
  _id: { type: String },
  nextRunAt: { type: Date, required: true },
  claimedAt: { type: Date },
  holder: { type: String, maxlength: 200 },
}, { timestamps: true });

module.exports = mongoose.model('SchedulerLease', schedulerLeaseSchema);
