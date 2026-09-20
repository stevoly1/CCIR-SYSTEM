const CustomAPIError = require('./customError');

class PayloadTooLargeError extends CustomAPIError {
  constructor(message) {
    super(message, 413, 'PAYLOAD_TOO_LARGE');
  }
}

module.exports = PayloadTooLargeError;
