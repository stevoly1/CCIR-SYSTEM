const express = require("express");
const {
  login,
  signup,
  googleAuthRedirect,
  googleAuthCallback
} = require("../controllers/authController");
const validate = require("../middleware/validate");
const { signupSchema, loginSchema } = require("../validators/userValidator");
const { emptyQuerySchema } = require('../validators/commonValidator');
const { forgotPassword, resetPassword, confirmEmailChange, verifyEmail } = require("../controllers/accountController");
const { forgotPasswordSchema, resetPasswordSchema, confirmEmailSchema, verifyEmailSchema, googleRedirectQuerySchema } = require("../validators/accountValidator");
const AuthRouter = express.Router();

AuthRouter.route("/signup").post(validate({ body: signupSchema, query: emptyQuerySchema }), signup);
AuthRouter.route("/login").post(validate({ body: loginSchema, query: emptyQuerySchema }), login);
AuthRouter.route("/google").get(validate({ query: googleRedirectQuerySchema }), googleAuthRedirect);
AuthRouter.route("/google/callback").get(googleAuthCallback);
AuthRouter.route("/password/forgot").post(validate({ body: forgotPasswordSchema, query: emptyQuerySchema }), forgotPassword);
AuthRouter.route("/email/confirm").post(validate({ body: confirmEmailSchema, query: emptyQuerySchema }), confirmEmailChange);
AuthRouter.route("/email/verify").post(validate({ body: verifyEmailSchema, query: emptyQuerySchema }), verifyEmail);
AuthRouter.route("/password/reset").post(validate({ body: resetPasswordSchema, query: emptyQuerySchema }), resetPassword);

module.exports = AuthRouter;
