import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer;
const MONGODB_VERSION = '8.2.6';

process.env.JWT_TOKEN ||= 'integration-access-secret';
process.env.JWT_REFRESH_TOKEN ||= 'integration-refresh-secret';
process.env.ACCESS_TOKEN_LIFESPAN ||= '15m';
process.env.REFRESH_TOKEN_LIFESPAN ||= '7d';
process.env.COOKIE ||= 'integration-cookie-secret';
process.env.ALLOWED_ORIGIN ||= 'http://localhost:3000';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    binary: { version: MONGODB_VERSION },
  });
  await mongoose.connect(mongoServer.getUri(), { dbName: 'ccir-integration' });
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});
