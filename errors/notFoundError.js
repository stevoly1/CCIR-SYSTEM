const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('./customError');

class NotFoundError extends CustomAPIError {
    constructor(message) {
        super(message, StatusCodes.NOT_FOUND, 'NOT_FOUND');
    }
}
module.exports = NotFoundError;
