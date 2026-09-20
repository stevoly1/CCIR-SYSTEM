const CustomAPIError = require('./customError');

class UnsupportedMediaTypeError extends CustomAPIError {
  constructor(message) {
    super(message, 415);
  }
}

module.exports = UnsupportedMediaTypeError;
