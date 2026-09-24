const mongoose = require('mongoose');
const { getLogger } = require('../utils/logger');
const { applyIndexPolicy } = require('./indexPolicy');

const connectDB = async () => {
    mongoose.connection.on('connected', () => {
        getLogger().info('Connected to MongoDB');
    });
    mongoose.connection.on('error', (error) => {
        getLogger().error({ err: error }, 'MongoDB connection error');
    });

    applyIndexPolicy(mongoose);

    return mongoose.connect(process.env.MONGO_URL);
};

module.exports = connectDB;
