import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer;
const MONGODB_VERSION = '8.2.6';

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
