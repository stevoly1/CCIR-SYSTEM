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
const { updateProfileSchema, adminUpdateUserSchema } = require('../validators/userValidator')


UserRouter.route("/").get(authentication, restrictTo('admin'), listAllUsers);
UserRouter.route("/profile").get(authentication, getProfile)
.patch(authentication, validate(updateProfileSchema), updateProfile)
.delete(authentication, deleteProfile);
UserRouter.route("/logout").post(authentication, logout);
UserRouter.route("/:id")
    .patch(authentication, restrictTo('admin'), validate(adminUpdateUserSchema), updateUser)
    .delete(authentication, restrictTo('admin'), deleteUser);

module.exports = UserRouter;
