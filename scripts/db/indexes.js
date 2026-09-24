// Compares declared Mongoose indexes with a database and, with --apply, creates the missing ones.
// Works with hosted (mongodb+srv://) and self-managed (mongodb://) databases through MONGO_URL.
//
//   npm run db:indexes                           report only (the default; changes nothing)
//   npm run db:indexes -- --apply                create missing indexes; keep any others
//   npm run db:indexes -- --apply --drop-extra   also drop indexes the models do not declare
//   npm run db:indexes -- --check                report, and exit 2 if any declared index is missing
//                                                (a deploy step can stop on it; 1 is an error)
const mongoose = require('mongoose');
const { scrubSecrets } = require('../../utils/logger');

// MongoDB will not build a declared unique index over an existing non-unique one on the same key.
// After checking that the values are in fact unique, the old index is dropped so --apply can build
// the unique one; duplicates stop the run with a count, leaving that index as it was.
const upgradeToUnique = async (model) => {
  let existing;
  try {
    existing = await model.collection.indexes();
  } catch (error) {
    if (error.codeName === 'NamespaceNotFound') return;
    throw error;
  }
  for (const [fields, options] of model.schema.indexes()) {
    if (!options?.unique) continue;
    const key = JSON.stringify(fields);
    const old = existing.find((index) => JSON.stringify(index.key) === key && !index.unique);
    if (!old) continue;
    const names = Object.keys(fields);
    // Sparse and partial unique indexes ignore documents without the field, so those are not duplicates.
    const onlyPresent = options.sparse || options.partialFilterExpression
      ? [{ $match: Object.fromEntries(names.map((name) => [name, { $exists: true }])) }]
      : [];
    const [found] = await model.collection.aggregate([
      ...onlyPresent,
      { $group: { _id: Object.fromEntries(names.map((name) => [name, `$${name}`])), count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'values' },
    ]).toArray();
    const repeated = found?.values ?? 0;
    if (repeated > 0) {
      throw new Error(`${model.collection.collectionName}: ${key} cannot be made unique: ${repeated} duplicated value${repeated === 1 ? '' : 's'}. Resolve them, then run --apply again.`);
    }
    await model.collection.dropIndex(old.name);
  }
};

const run = async ({ uri = process.env.MONGO_URL, apply = false, dropExtra = false, out = process.stdout } = {}) => {
  if (!uri) throw new Error('MONGO_URL is not set');
  if (dropExtra && !apply) throw new Error('--drop-extra requires --apply');
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  require('../../models');
  const { missingUniqueIndexes } = require('../../services/readinessService');
  const seedDefaultCategories = require('../../utils/seedCategories');
  await mongoose.connect(uri);
  try {
    const report = {};
    for (const model of Object.values(mongoose.models)) {
      if (apply) {
        await upgradeToUnique(model);
        if (dropExtra) await model.syncIndexes();
        else await model.createIndexes();
      }
      // toCreate lists index keys, toDrop lists index names. A collection that does not exist yet
      // reports every declared index as missing.
      const { toCreate, toDrop } = await model.diffIndexes();
      report[model.modelName] = { toCreate, toDrop };
    }
    const missingUnique = await missingUniqueIndexes(mongoose.connection, mongoose.models);
    // With the unique indexes in place the defaults can be seeded safely (the server skips them
    // in production until then); report mode never writes.
    const seeded = apply ? (await seedDefaultCategories({ requireUniqueIndexes: true })).seeded : false;
    out.write(`${JSON.stringify({ applied: apply, dropExtra, report, missingUnique, seeded }, null, 2)}\n`);
    const complete = missingUnique.length === 0 && Object.values(report).every((entry) => entry.toCreate.length === 0);
    return { report, missingUnique, seeded, complete };
  } finally {
    // Only the connection opened here; a caller's other connections stay open.
    await mongoose.connection.close();
  }
};

if (require.main === module) {
  // Only the command line reads .env; importing run() (the tests do) leaves the environment alone.
  require('dotenv').config({ quiet: true });
  const args = process.argv.slice(2);
  const known = new Set(['--apply', '--drop-extra', '--check']);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    process.stderr.write(`Unknown option: ${unknown.join(' ')}\n`);
    process.exitCode = 2;
  } else {
    run({ apply: args.includes('--apply'), dropExtra: args.includes('--drop-extra') })
      .then(({ complete }) => {
        if (args.includes('--check') && !complete) process.exitCode = 2;
      })
      .catch((error) => {
        // Driver messages can name the host; credentials and URL secrets are always removed.
        process.stderr.write(`${scrubSecrets(String(error.message))}\n`);
        process.exitCode = 1;
      });
  }
}

module.exports = { run };
