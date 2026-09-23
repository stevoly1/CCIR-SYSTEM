const mongoose = require('mongoose');
const { categorySlug, cleanCategoryName, normaliseCategoryName } = require('../utils/categoryName');

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const categorySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Category name is required'],
            unique: true,
            trim: true,
            minlength: 2,
            maxlength: 60,
        },
        // Case- and spacing-insensitive identity. Sparse because legacy categories lack
        // it until the Phase 2 migration; a non-sparse unique index cannot build over them.
        nameKey: {
            type: String,
            required: true,
            unique: true,
            sparse: true,
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

categorySchema.pre('validate', function normaliseName(next) {
    if (this.name) {
        this.name = cleanCategoryName(this.name);
        this.nameKey = normaliseCategoryName(this.name);
        this.slug = categorySlug(this.name);
    }
    next();
});

module.exports = mongoose.model('Category', categorySchema);
module.exports.PRIORITIES = PRIORITIES;
