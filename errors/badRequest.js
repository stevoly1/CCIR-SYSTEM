const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('./customError');

class BadRequestError extends CustomAPIError {
    constructor(message, code = 'BAD_REQUEST', details) {
        super(message, StatusCodes.BAD_REQUEST, code, details);
    }
}
module.exports = BadRequestError;
