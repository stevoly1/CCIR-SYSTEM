const mongoose = require('mongoose');
const { StatusCodes } = require('http-status-codes');
const { Category, Complaint } = require('../models');
const CustomError = require('../errors');
const { categoryInUse, categoryNameConflict, categoryProtected } = require('../errors/domainErrors');
const { normaliseCategoryName } = require('../utils/categoryName');

const FALLBACK_KEY = 'other';
const isFallback = (category) => normaliseCategoryName(category.name) === FALLBACK_KEY;

// Uniqueness is enforced by the unique `nameKey` index, so concurrent creates and
// renames cannot both succeed; the duplicate-key error becomes a specific conflict.
const mapNameConflicts = async (operation) => {
    try {
        return await operation();
    } catch (error) {
        if (error?.code === 11000) throw categoryNameConflict();
        throw error;
    }
};

const createCategory = async (req, res) => {
    const category = await mapNameConflicts(() => Category.create(req.body));
    res.status(StatusCodes.CREATED).json({ category });
};

const getAllCategories = async (req, res) => {
    if (req.user.role === 'citizen') {
        const categories = await Category.find({ isActive: true }).sort({ name: 1 }).select('name description');
        return res.status(StatusCodes.OK).json({
            categories: categories.map((category) => ({
                _id: category._id,
                name: category.name,
                description: category.description ?? '',
            })),
        });
    }

    const categories = await Category.find({}).sort({ name: 1 }).lean();
    if (req.user.role === 'admin') {
        const counts = await Complaint.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);
        const countById = new Map(counts.map((row) => [String(row._id), row.count]));
        categories.forEach((category) => {
            category.complaintCount = countById.get(String(category._id)) ?? 0;
        });
    }
    return res.status(StatusCodes.OK).json({ categories });
};

const getSingleCategory = async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new CustomError.NotFoundError(`No category found with id ${req.params.id}`);
    res.status(StatusCodes.OK).json({ category });
};

const updateCategory = async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new CustomError.NotFoundError(`No category found with id ${req.params.id}`);
    if (isFallback(category)) {
        const renamesAway = Object.hasOwn(req.body, 'name') && normaliseCategoryName(req.body.name) !== FALLBACK_KEY;
        if (renamesAway || req.body.isActive === false) throw categoryProtected();
    }

    Object.assign(category, req.body);
    await mapNameConflicts(() => category.save());

    res.status(StatusCodes.OK).json({ category });
};

// Only an inactive, unreferenced category may be deleted. Requiring deactivation first
// closes the race where a complaint being filed picks an active category that is then
// removed; the reference check and delete share one transaction.
const deleteCategory = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const category = await Category.findById(req.params.id).session(session);
            if (!category) throw new CustomError.NotFoundError(`No category found with id ${req.params.id}`);
            if (isFallback(category)) throw categoryProtected();
            if (category.isActive !== false) throw categoryInUse();
            if (await Complaint.exists({ category: category._id }).session(session)) throw categoryInUse();
            await category.deleteOne({ session });
        });
    } finally {
        await session.endSession();
    }

    res.status(StatusCodes.OK).json({ msg: 'Category deleted' });
};

module.exports = {
    createCategory,
    getAllCategories,
    getSingleCategory,
    updateCategory,
    deleteCategory,
};
