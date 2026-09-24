const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('./customError');

// retryAfterSeconds, when a throttle knows it, is sent as Retry-After and named in the message.
class TooManyRequestsError extends CustomAPIError {
    constructor(message = 'Too many authentication attempts, please try again later', { retryAfterSeconds } = {}) {
        super(message, StatusCodes.TOO_MANY_REQUESTS, 'RATE_LIMITED');
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
            this.retryAfterSeconds = Math.ceil(retryAfterSeconds);
        }
    }
}

module.exports = TooManyRequestsError;
