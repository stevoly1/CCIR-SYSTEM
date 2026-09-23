const { StatusCodes } = require('http-status-codes');
const CustomAPIError = require('../errors/customError');
const { getLogger } = require('../utils/logger');

const validationDetail = (path) => ({
    path,
    code: path.endsWith('.id') ? 'INVALID_IDENTIFIER' : 'INVALID_VALUE',
    message: path.endsWith('.id') ? 'A valid identifier is required' : 'Invalid value',
});

const knownError = (err) => {
    if (err instanceof CustomAPIError) {
        if (err.code === 'PAYLOAD_TOO_LARGE') {
            return { status: 413, code: err.code, message: 'Upload exceeds allowed limits' };
        }
        if (err.code === 'UNSUPPORTED_MEDIA_TYPE') {
            return { status: 415, code: err.code, message: 'Unsupported media type' };
        }
        if (err.code === 'RATE_LIMITED') {
            return { status: 429, code: err.code, message: 'Too many requests, please try again later' };
        }
        return {
            status: err.statusCode,
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
        };
    }
    if (err.name === 'ValidationError') {
        return {
            status: StatusCodes.BAD_REQUEST,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: Object.keys(err.errors || {}).map((path) => validationDetail(`body.${path}`)),
        };
    }
    if (err instanceof SyntaxError && err.status === 400 && Object.hasOwn(err, 'body')) {
        return {
            status: StatusCodes.BAD_REQUEST,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'body', code: 'INVALID_JSON', message: 'Malformed JSON body' }],
        };
    }
    if (err.code === 11000) {
        return { status: StatusCodes.CONFLICT, code: 'CONFLICT', message: 'Resource already exists' };
    }
    if (err.name === 'CastError') {
        return {
            status: StatusCodes.BAD_REQUEST,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [validationDetail('params.id')],
        };
    }
    if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
        return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Upload exceeds allowed limits' };
    }
    return null;
};

// Every error is logged with the request id. Unexpected errors are logged in full (stack
// included) and return the request id so a report can be matched to its log line; known,
// expected rejections are logged briefly, without a stack.
const errorHandlerMiddleware = (err, req, res, next) => {
    const log = req.log || getLogger();

    // Too late for an error body: log it and end the connection so the client sees a cut-off
    // response. (Handing it to Express would print it to the console instead of the logger.)
    if (res.headersSent) {
        log.error({ err, requestId: req.id }, 'Unhandled error');
        res.destroy();
        return undefined;
    }

    const mapped = knownError(err);

    if (!mapped) {
        log.error({ err, requestId: req.id }, 'Unhandled error');
        const error = { code: 'INTERNAL_ERROR', message: 'Something went wrong', ...(req.id ? { requestId: req.id } : {}) };
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error, msg: error.message });
    }

    const level = mapped.status >= 500 ? 'warn' : 'info';
    log[level]({ requestId: req.id, code: mapped.code, status: mapped.status }, 'Request rejected');
    const error = {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details ? { details: mapped.details } : {}),
    };
    return res.status(mapped.status).json({ error, msg: mapped.message });
};

module.exports = errorHandlerMiddleware
