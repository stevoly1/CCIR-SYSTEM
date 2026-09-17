const CustomError = require('../errors');

// Usage: validate(someZodSchema) — validates and replaces req.body with the parsed result.
const validate = (schema) => {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            const message = result.error.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join(', ');
            throw new CustomError.BadRequestError(message);
        }

        req.body = result.data;
        next();
    };
};

module.exports = validate;
