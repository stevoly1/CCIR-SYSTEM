const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('./customError');

class BadRequestError extends CustomAPIError {
    constructor(message) {
        super(message, StatusCodes.BAD_REQUEST);
    }
}
module.exports = BadRequestError;