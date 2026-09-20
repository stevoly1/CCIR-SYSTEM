const CustomError = require('../errors');

const issueCode = (issue) => {
    if (issue.message === 'A valid identifier is required') return 'INVALID_IDENTIFIER';
    if (issue.code === 'unrecognized_keys') return 'UNKNOWN_FIELD';
    if (issue.code === 'invalid_type') return 'INVALID_TYPE';
    return 'INVALID_VALUE';
};

const issueDetails = (part, issues) => issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((key) => ({
            path: [part, ...issue.path, key].join('.'),
            code: 'UNKNOWN_FIELD',
            message: 'Unknown field is not allowed',
        }));
    }
    return [{
        path: [part, ...issue.path].join('.'),
        code: issueCode(issue),
        message: issue.message,
    }];
});

const validate = (schemas) => {
    return (req, res, next) => {
        const details = [];
        const parsed = {};

        for (const part of ['body', 'params', 'query']) {
            const schema = schemas[part];
            if (!schema) continue;
            const source = part === 'body' ? (req.body ?? {}) : req[part];
            const result = schema.safeParse(source);
            if (result.success) parsed[part] = result.data;
            else details.push(...issueDetails(part, result.error.issues));
        }

        if (details.length > 0) {
            throw new CustomError.BadRequestError(
                'Request validation failed',
                'VALIDATION_ERROR',
                details,
            );
        }

        for (const [part, value] of Object.entries(parsed)) {
            if (part === 'query') {
                Object.defineProperty(req, 'query', {
                    value,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                });
            } else {
                req[part] = value;
            }
        }
        next();
    };
};

module.exports = validate;
