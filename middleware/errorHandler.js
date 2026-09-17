const { StatusCodes } = require('http-status-codes');

const errorHandlerMiddleware = (err, req, res, next) => {
    let customerror = {
        statusCode: err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
        msg: err.message || 'something went wrong'
    }

    if (err.name === 'ValidationError') {
        customerror.msg = Object.values(err.errors).map((item) => item.message).join(',')
        customerror.statusCode = 400
    }
    if (err.code && err.code === 11000) {
        customerror.msg = `Duplicate value entered for ${Object.keys(
      err.keyValue
    )} field, please choose another value`
        customerror.statusCode = 400
    }
    if (err.name === 'CastError') {
        customerror.msg = `Id : ${err.value} not found`
        customerror.statusCode = 404
    }

    return res.status(customerror.statusCode).json({ msg: customerror.msg })
}


module.exports = errorHandlerMiddleware