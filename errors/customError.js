class CustomAPIError extends Error {
    constructor(message, statusCode, code, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code || ({
            400: 'BAD_REQUEST',
            401: 'UNAUTHENTICATED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            413: 'PAYLOAD_TOO_LARGE',
            415: 'UNSUPPORTED_MEDIA_TYPE',
            429: 'RATE_LIMITED',
            503: 'SERVICE_UNAVAILABLE',
        }[statusCode] || 'REQUEST_ERROR');
        if (details !== undefined) this.details = details;
    }
}

module.exports = CustomAPIError;
