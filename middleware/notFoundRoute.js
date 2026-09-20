const NotFoundMiddleware = (req, res) => res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found' },
    msg: 'Route not found',
});

module.exports = NotFoundMiddleware
