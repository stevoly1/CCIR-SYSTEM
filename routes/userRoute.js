const express = require("express");
const {
    getProfile,
    updateProfile,
    deleteProfile,
    listAllUsers,
    updateUser,
    deleteUser,
    logout
} = require("../controllers/userController");
const UserRouter = express.Router();
const { authentication } = require('../middleware/auth')
const restrictTo = require('../middleware/restrictTo')
const validate = require('../middleware/validate')
const { updateProfileSchema, adminUpdateUserSchema, userListQuerySchema } = require('../validators/userValidator')
const { emptyQuerySchema, idParamsSchema, retirementBodySchema } = require('../validators/commonValidator')


UserRouter.route("/").get(authentication, restrictTo('admin'), validate({ query: userListQuerySchema }), listAllUsers);
UserRouter.route("/profile").get(authentication, validate({ query: emptyQuerySchema }), getProfile)
.patch(authentication, validate({ body: updateProfileSchema, query: emptyQuerySchema }), updateProfile)
.delete(authentication, validate({ body: retirementBodySchema, query: emptyQuerySchema }), deleteProfile);
UserRouter.route("/logout").post(authentication, validate({ body: emptyQuerySchema, query: emptyQuerySchema }), logout);
UserRouter.route("/:id")
    .patch(authentication, restrictTo('admin'), validate({ params: idParamsSchema, body: adminUpdateUserSchema, query: emptyQuerySchema }), updateUser)
    .delete(authentication, restrictTo('admin'), validate({ params: idParamsSchema, body: retirementBodySchema, query: emptyQuerySchema }), deleteUser);

module.exports = UserRouter;
