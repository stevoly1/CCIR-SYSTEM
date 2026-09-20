const mongoose = require('mongoose');

const oauthStateSchema = new mongoose.Schema({
  digest: {
    type: String,
    required: true,
    unique: true,
    match: /^[0-9a-f]{64}$/,
  },
  expiresAt: {
    type: Date,
    required: true,
    expires: 0,
  },
}, { timestamps: true });

module.exports = mongoose.model('OAuthState', oauthStateSchema);
