const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('./customError');

class ForbiddenError extends CustomAPIError {
    constructor(message, code = 'FORBIDDEN') {
        super(message, StatusCodes.FORBIDDEN, code);
    }
}
module.exports = ForbiddenError;
