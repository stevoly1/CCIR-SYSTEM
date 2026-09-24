require('dotenv').config();

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const seedDefaultCategories = require('./utils/seedCategories');
const { getLogger } = require('./utils/logger');

const port = process.env.PORT || 8080;

const startApp = async () => {
  try {
    await connectDB();
    const seeding = await seedDefaultCategories({ requireUniqueIndexes: process.env.NODE_ENV === 'production' });
    if (!seeding.seeded) {
      getLogger().warn({ reason: seeding.reason }, 'Default categories not seeded; run npm run db:indexes -- --apply');
    }

    const server = http.createServer(app);
    server.listen(port, () => {
      getLogger().info({ port: Number(port) }, 'App is listening');
    });

    return server;
  } catch (error) {
    getLogger().fatal({ err: error }, 'Failed to start app');
    process.exitCode = 1;
    return null;
  }
};

if (require.main === module) {
  startApp();
}

module.exports = startApp;
