const express = require('express');
const CategoryRouter = express.Router();
const { authentication } = require('../middleware/auth');
const restrictTo = require('../middleware/restrictTo');
const validate = require('../middleware/validate');
const { createCategorySchema, updateCategorySchema } = require('../validators/categoryValidator');
const {
    createCategory,
    getAllCategories,
    getSingleCategory,
    updateCategory,
    deleteCategory,
} = require('../controllers/categoryController');

CategoryRouter.route('/')
    .post(authentication, restrictTo('admin'), validate(createCategorySchema), createCategory)
    .get(authentication, getAllCategories);

CategoryRouter.route('/:id')
    .get(authentication, getSingleCategory)
    .patch(authentication, restrictTo('admin'), validate(updateCategorySchema), updateCategory)
    .delete(authentication, restrictTo('admin'), deleteCategory);

module.exports = CategoryRouter;
