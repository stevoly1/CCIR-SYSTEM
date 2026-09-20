const { StatusCodes } = require('http-status-codes');
const { Category, Complaint } = require('../models');
const CustomError = require('../errors');

const SYSTEM_FALLBACK_CATEGORY = 'Other';

const protectSystemFallback = (category, changes = {}) => {
    if (category.name !== SYSTEM_FALLBACK_CATEGORY) return;
    if (
        (Object.hasOwn(changes, 'name') && changes.name !== SYSTEM_FALLBACK_CATEGORY)
        || changes.isActive === false
    ) {
        throw new CustomError.ConflictError('Other is the required active fallback category');
    }
};

const createCategory = async (req, res) => {
    const existing = await Category.findOne({ name: req.body.name });
    if (existing) throw new CustomError.BadRequestError('A category with this name already exists');

    const category = await Category.create(req.body);
    res.status(StatusCodes.CREATED).json({ category });
};

const getAllCategories = async (req, res) => {
    const filter = req.user?.role === 'citizen' ? { isActive: true } : {};
    const categories = await Category.find(filter).sort({ name: 1 });
    res.status(StatusCodes.OK).json({ categories });
};

const getSingleCategory = async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new CustomError.NotFoundError(`No category found with id ${req.params.id}`);
    res.status(StatusCodes.OK).json({ category });
};

const updateCategory = async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new CustomError.NotFoundError(`No category found with id ${req.params.id}`);
    protectSystemFallback(category, req.body);

    Object.assign(category, req.body);
    await category.save();

    res.status(StatusCodes.OK).json({ category });
};

const deleteCategory = async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new CustomError.NotFoundError(`No category found with id ${req.params.id}`);
    if (category.name === SYSTEM_FALLBACK_CATEGORY) {
        throw new CustomError.ConflictError('Other is the required active fallback category');
    }

    const inUse = await Complaint.exists({ category: req.params.id });
    if (inUse) {
        throw new CustomError.BadRequestError(
            'This category is in use by existing complaints. Deactivate it instead of deleting it'
        );
    }

    await category.deleteOne();

    res.status(StatusCodes.OK).json({ msg: 'Category deleted' });
};

module.exports = {
    createCategory,
    getAllCategories,
    getSingleCategory,
    updateCategory,
    deleteCategory,
};
