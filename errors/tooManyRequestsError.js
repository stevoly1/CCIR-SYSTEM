const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('./customError');

class TooManyRequestsError extends CustomAPIError {
    constructor(message = 'Too many authentication attempts, please try again later') {
        super(message, StatusCodes.TOO_MANY_REQUESTS, 'RATE_LIMITED');
    }
}

module.exports = TooManyRequestsError;
