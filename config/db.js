const mongoose = require('mongoose');

const connectDB = async () => {
    mongoose.connection.on('connected', () => {
        console.log('Connected to MongoDB');
    });
    mongoose.connection.on('error', (error) => {
        console.error('MongoDB connection error:', error.message);
    });

    return mongoose.connect(process.env.MONGO_URL);
};

module.exports = connectDB;
