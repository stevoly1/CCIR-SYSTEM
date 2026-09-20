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
const AuthRouter = express.Router();

AuthRouter.route("/signup").post(validate({ body: signupSchema, query: emptyQuerySchema }), signup);
AuthRouter.route("/login").post(validate({ body: loginSchema, query: emptyQuerySchema }), login);
AuthRouter.route("/google").get(validate({ query: emptyQuerySchema }), googleAuthRedirect);
AuthRouter.route("/google/callback").get(googleAuthCallback);

module.exports = AuthRouter;
