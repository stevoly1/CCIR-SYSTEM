const CustomAPIError = require('./customError');

class UnsupportedMediaTypeError extends CustomAPIError {
  constructor(message) {
    super(message, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

module.exports = UnsupportedMediaTypeError;
