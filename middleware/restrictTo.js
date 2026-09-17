const CustomError = require('../errors');

// Usage: restrictTo('admin', 'agency') — must run after `authentication`.
const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            throw new CustomError.ForbiddenError('You do not have permission to perform this action');
        }
        next();
    };
};

module.exports = restrictTo;
