// npm run db:rehearse
// Proves backup and restore on a disposable in-memory replica set: seeds every collection, backs
// it up, restores into a second database, and compares counts, checksums and indexes. It never
// reads MONGO_URL or touches a real database. Needs the development dependencies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MONGODB_TEST_VERSION } = require('../../tests/setup/mongoVersion.cjs');
const { startWithPortRetry } = require('../../tests/setup/memoryMongo.cjs');
const { backup } = require('./backup');
const { restore } = require('./restore');
const { databaseSnapshot } = require('./common');

const withDatabase = (uri, name) => { const url = new URL(uri); url.pathname = `/${name}`; return url.toString(); };

const seedEveryCollection = async (uri) => {
  await mongoose.connect(uri);
  require('../../models');
  const { User, Category, Complaint, ComplaintDeletion, RefreshToken, AuthThrottle, OAuthState, AdminControl } = mongoose.models;
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  const admin = await User.create({ name: 'Rehearsal Admin', email: 'rehearsal.admin@example.test', password: 'Rehearsal-pass-1', role: 'admin' });
  const citizen = await User.create({ name: 'Rehearsal Citizen', email: 'rehearsal.citizen@example.test', password: 'Rehearsal-pass-1' });
  const other = await Category.create({ name: 'Other', defaultPriority: 'LOW' });
  for (let i = 0; i < 25; i += 1) {
    await Complaint.create({ referenceCode: `CCIR-RH${String(i).padStart(6, '0')}`, description: `Rehearsal complaint number ${i}`, category: other._id, categorySnapshot: { categoryId: other._id, name: 'Other' }, reporter: citizen._id, location: { address: `${i} Rehearsal Road` } });
  }
  await ComplaintDeletion.create({ complaintId: new mongoose.Types.ObjectId(), referenceCode: 'CCIR-RHDEL001', statusAtDeletion: 'PENDING', deletedBy: { userId: admin._id, displayName: 'Rehearsal Admin', role: 'admin' }, reason: 'rehearsal', deletedAt: new Date() });
  await RefreshToken.create({ token: 'rehearsal-token', user: citizen._id, expiresAt: new Date(Date.now() + 86400000) });
  // Expiries a day ahead: the comparison below covers these self-expiring rows too, and MongoDB's
  // expiry sweep must not delete them during a slow rehearsal.
  await AuthThrottle.create({ _id: 'rehearsal:key', count: 1, resetAt: new Date(Date.now() + 86400000) });
  await OAuthState.create({ digest: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86400000) });
  await AdminControl.create({ _id: 'accountLifecycle', revision: 1 });
  await mongoose.disconnect();
};

const rehearse = async () => {
  const replSet = await startWithPortRetry(() => new MongoMemoryReplSet({ binary: { version: MONGODB_TEST_VERSION }, replSet: { count: 1, storageEngine: 'wiredTiger' } }));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-rehearsal-'));
  try {
    const source = withDatabase(replSet.getUri(), 'ccir-rehearsal-source');
    const target = withDatabase(replSet.getUri(), 'ccir-rehearsal-target');
    await seedEveryCollection(source);
    const { archive, manifest } = await backup({ uri: source, out });
    await restore({ archive, uri: target });
    const [a, b] = [await databaseSnapshot(source), await databaseSnapshot(target)];
    const differences = Object.keys(a.collections).filter((name) => JSON.stringify(a.collections[name]) !== JSON.stringify(b.collections[name]));
    const result = {
      serverVersion: a.serverVersion,
      toolVersion: manifest.toolVersion,
      collections: Object.fromEntries(Object.entries(a.collections).map(([n, c]) => [n, c.count])),
      differences,
      passed: differences.length === 0,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
    return result;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    await replSet.stop();
  }
};

if (require.main === module) rehearse().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { rehearse };
