const express = require("express");
const {
    getProfile,
    updateProfile,
    deleteProfile,
    listAllUsers,
    listAssignableUsers,
    updateUser,
    deleteUser,
    logout
} = require("../controllers/userController");
const { changePassword, requestOwnEmailChange, requestUserEmailChange } = require('../controllers/accountController');
const { changePasswordSchema, requestOwnEmailChangeSchema, requestEmailChangeSchema } = require('../validators/accountValidator');
const UserRouter = express.Router();
const { authentication } = require('../middleware/auth')
const restrictTo = require('../middleware/restrictTo')
const validate = require('../middleware/validate')
const { updateProfileSchema, adminUpdateUserSchema, userListQuerySchema } = require('../validators/userValidator')
const { emptyQuerySchema, idParamsSchema, retirementBodySchema } = require('../validators/commonValidator')


UserRouter.route("/").get(authentication, restrictTo('admin'), validate({ query: userListQuerySchema }), listAllUsers);
UserRouter.route("/assignable").get(authentication, restrictTo('admin'), validate({ query: emptyQuerySchema }), listAssignableUsers);
UserRouter.route("/profile").get(authentication, validate({ query: emptyQuerySchema }), getProfile)
.patch(authentication, validate({ body: updateProfileSchema, query: emptyQuerySchema }), updateProfile)
.delete(authentication, validate({ body: retirementBodySchema, query: emptyQuerySchema }), deleteProfile);
UserRouter.route("/profile/password").post(authentication, validate({ body: changePasswordSchema, query: emptyQuerySchema }), changePassword);
// Before "/:id/email": Express matches in order, and "profile" would otherwise be taken for an id.
UserRouter.route("/profile/email").post(authentication, validate({ body: requestOwnEmailChangeSchema, query: emptyQuerySchema }), requestOwnEmailChange);
UserRouter.route("/logout").post(authentication, validate({ body: emptyQuerySchema, query: emptyQuerySchema }), logout);
UserRouter.route("/:id/email").post(authentication, restrictTo('admin'), validate({ params: idParamsSchema, body: requestEmailChangeSchema, query: emptyQuerySchema }), requestUserEmailChange);
UserRouter.route("/:id")
    .patch(authentication, restrictTo('admin'), validate({ params: idParamsSchema, body: adminUpdateUserSchema, query: emptyQuerySchema }), updateUser)
    .delete(authentication, restrictTo('admin'), validate({ params: idParamsSchema, body: retirementBodySchema, query: emptyQuerySchema }), deleteUser);

module.exports = UserRouter;
