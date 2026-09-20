const express = require('express');
const CategoryRouter = express.Router();
const { authentication } = require('../middleware/auth');
const restrictTo = require('../middleware/restrictTo');
const validate = require('../middleware/validate');
const { createCategorySchema, updateCategorySchema } = require('../validators/categoryValidator');
const { emptyQuerySchema, idParamsSchema } = require('../validators/commonValidator');
const {
    createCategory,
    getAllCategories,
    getSingleCategory,
    updateCategory,
    deleteCategory,
} = require('../controllers/categoryController');

CategoryRouter.route('/')
    .post(authentication, restrictTo('admin'), validate({ body: createCategorySchema, query: emptyQuerySchema }), createCategory)
    .get(authentication, validate({ query: emptyQuerySchema }), getAllCategories);

CategoryRouter.route('/:id')
    .get(authentication, validate({ params: idParamsSchema, query: emptyQuerySchema }), getSingleCategory)
    .patch(authentication, restrictTo('admin'), validate({ params: idParamsSchema, body: updateCategorySchema, query: emptyQuerySchema }), updateCategory)
    .delete(authentication, restrictTo('admin'), validate({ params: idParamsSchema, query: emptyQuerySchema }), deleteCategory);

module.exports = CategoryRouter;
