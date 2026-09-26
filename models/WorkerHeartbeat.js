const mongoose = require('mongoose');

// One per running worker process, rewritten every 30 seconds. Readiness reads it instead of
// pinging Redis, which on a per-command plan would cost commands for every probe.
const workerHeartbeatSchema = new mongoose.Schema({
  _id: { type: String },
  host: { type: String, required: true },
  pid: { type: Number, required: true },
  startedAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
}, { versionKey: false });

workerHeartbeatSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 24 * 3600 });

module.exports = mongoose.model('WorkerHeartbeat', workerHeartbeatSchema);
