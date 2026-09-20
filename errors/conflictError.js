const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('./customError');

class ConflictError extends CustomAPIError {
  constructor(message) {
    super(message, StatusCodes.CONFLICT, 'CONFLICT');
  }
}

module.exports = ConflictError;
