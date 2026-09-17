const mongoose = require('mongoose');

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const categorySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Category name is required'],
            unique: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        defaultPriority: {
            type: String,
            enum: PRIORITIES,
            default: 'MEDIUM',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

categorySchema.pre('validate', function slugify(next) {
    if (this.name) {
        this.slug = this.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }
    next();
});

module.exports = mongoose.model('Category', categorySchema);
module.exports.PRIORITIES = PRIORITIES;
