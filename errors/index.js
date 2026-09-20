module.exports = {
    CustomAPIError: require('./customError'),
    NotFoundError: require('./notFoundError'),
    BadRequestError: require('./badRequest'),
    UnauthenticatedError: require('./unauthenticatedError'),
    ForbiddenError: require('./forbiddenError'),
    ConflictError: require('./conflictError'),
    PayloadTooLargeError: require('./payloadTooLargeError'),
    UnsupportedMediaTypeError: require('./unsupportedMediaTypeError'),
    TooManyRequestsError: require('./tooManyRequestsError'),
};
