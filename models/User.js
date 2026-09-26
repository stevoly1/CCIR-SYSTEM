const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['citizen', 'admin', 'agency'];
const AUTH_PROVIDERS = ['local', 'google'];

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Name is required'],
            trim: true,
            minlength: 2,
            maxlength: 60,
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: [
                function passwordRequired() {
                    return this.authProvider === 'local' && this.isActive !== false && !this.retiredAt;
                },
                'Password is required',
            ],
            minlength: 6,
            select: false,
        },
        phone: {
            type: String,
            trim: true,
        },
        role: {
            type: String,
            enum: ROLES,
            default: 'citizen',
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        retiredAt: {
            type: Date,
        },
        // When the account holder proved the address (a link, a confirmed email change, or Google).
        emailVerifiedAt: {
            type: Date,
            default: null,
        },
        retiredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        retirementReason: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        // Set when an administrator suspends the account (isActive false); cleared on reactivation.
        suspendedAt: {
            type: Date,
        },
        suspendedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        suspensionReason: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        authProvider: {
            type: String,
            enum: AUTH_PROVIDERS,
            default: 'local',
        },
        googleId: {
            type: String,
            unique: true,
            sparse: true,
        },
        avatarUrl: {
            type: String,
        },
    },
    { timestamps: true }
);

userSchema.pre('save', async function hashPassword() {
    if (!this.isModified('password') || !this.password) return;
    this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
    if (!this.password) return Promise.resolve(false);
    return bcrypt.compare(plainPassword, this.password);
};

userSchema.set('toJSON', {
    transform: (_doc, ret) => {
        delete ret.password;
        ret.emailVerified = Boolean(ret.emailVerifiedAt) || ret.authProvider === 'google';
        return ret;
    },
});

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
