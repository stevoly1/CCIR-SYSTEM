const express = require("express");
const {
  login,
  signup,
  googleAuthRedirect,
  googleAuthCallback
} = require("../controllers/authController");
const validate = require("../middleware/validate");
const { signupSchema, loginSchema } = require("../validators/userValidator");
const AuthRouter = express.Router();

AuthRouter.route("/signup").post(validate(signupSchema), signup);
AuthRouter.route("/login").post(validate(loginSchema), login);
AuthRouter.route("/google").get(googleAuthRedirect);
AuthRouter.route("/google/callback").get(googleAuthCallback);

module.exports = AuthRouter;