const CustomAPIError = require('./customError');

class PayloadTooLargeError extends CustomAPIError {
  constructor(message) {
    super(message, 413);
  }
}

module.exports = PayloadTooLargeError;
