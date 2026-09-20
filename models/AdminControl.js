const mongoose = require('mongoose');

const adminControlSchema = new mongoose.Schema(
  {
    _id: { type: String },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('AdminControl', adminControlSchema);
