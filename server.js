require('dotenv').config();

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const seedDefaultCategories = require('./utils/seedCategories');

const port = process.env.PORT || 8080;

const startApp = async () => {
  try {
    await connectDB();
    await seedDefaultCategories();

    const server = http.createServer(app);
    server.listen(port, () => {
      console.log(`App is listening on port ${port}`);
    });

    return server;
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exitCode = 1;
    return null;
  }
};

if (require.main === module) {
  startApp();
}

module.exports = startApp;
