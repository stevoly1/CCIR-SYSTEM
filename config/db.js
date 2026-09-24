const mongoose = require('mongoose');
const { getLogger } = require('../utils/logger');

const connectDB = async () => {
    mongoose.connection.on('connected', () => {
        getLogger().info('Connected to MongoDB');
    });
    mongoose.connection.on('error', (error) => {
        getLogger().error({ err: error }, 'MongoDB connection error');
    });

    // Production builds indexes deliberately with `npm run db:indexes -- --apply`; the readiness
    // check refuses traffic while a unique index is missing.
    mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');

    return mongoose.connect(process.env.MONGO_URL);
};

module.exports = connectDB;
