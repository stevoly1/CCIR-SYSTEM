// RESTORE_TARGET_URL='<target>' npm run db:restore -- --archive <file> [--drop --confirm-drop]
// Restores a db:backup archive into the database named in the target. The target is never taken
// from MONGO_URL. It comes from RESTORE_TARGET_URL, or from --uri only when it holds no password
// (the command line is visible to other local users and kept in shell history). A non-empty target
// is refused unless --drop --confirm-drop are both given, and the restored collections are checked
// against the backup manifest.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { scrubSecrets } = require('../../utils/logger');
const { parseArgs, databaseNameFrom, restoreMismatches, dropCollections, assertRestoreAllowed, requireTool, withToolConfig, runTool, sha256File, databaseSnapshot } = require('./common');

const restore = async ({ archive, uri, drop = false, confirmDrop = false }) => {
  if (!archive || !uri) throw new Error('An archive and a target are required; the target is never taken from MONGO_URL.');
  if (!databaseNameFrom(uri)) throw new Error('The restore target must name its database (…/<database>); without one MongoDB would restore into "test".');
  const manifest = JSON.parse(fs.readFileSync(archive.replace(/\.archive\.gz$/, '.manifest.json'), 'utf8'));
  if (sha256File(archive) !== manifest.archiveSha256) throw new Error('The archive does not match its manifest checksum.');
  const mongorestore = requireTool('mongorestore');
  const before = await databaseSnapshot(uri);
  assertRestoreAllowed({ targetIsEmpty: Object.values(before.collections).every((c) => c.count === 0), drop, confirmDrop });
  // The database in the connection string acts as a namespace filter for mongorestore, so the
  // archive's own namespace is included explicitly or nothing is restored (while exiting 0).
  // The connection string itself stays unchanged, so its authentication database is preserved.
  const args = [`--archive=${archive}`, '--gzip', '--quiet', `--nsInclude=${manifest.database}.*`, `--nsFrom=${manifest.database}.*`, `--nsTo=${before.database}.*`, ...(drop ? ['--drop'] : [])];
  const result = await withToolConfig(uri, (config) => runTool(mongorestore, [`--config=${config}`, ...args]));
  if (result.status !== 0) throw new Error(`mongorestore failed: ${scrubSecrets(result.stderr.trim())}`);
  // mongorestore --drop replaces only the collections the archive holds. A replaced target must be
  // an exact copy, so the non-empty collections the backup does not have are dropped as well (they
  // can exist only in a non-empty target, which needs --drop --confirm-drop to get this far).
  await dropCollections(uri, Object.entries(before.collections)
    .filter(([name, c]) => !manifest.collections[name] && c.count > 0)
    .map(([name]) => name));
  const after = await databaseSnapshot(uri);
  const mismatches = restoreMismatches(manifest.collections, after.collections);
  if (mismatches.length) throw new Error(`Restored collections differ from the manifest: ${mismatches.join(', ')}`);
  return { database: after.database, collections: Object.keys(manifest.collections).length };
};

const HAS_PASSWORD = /^mongodb(?:\+srv)?:\/\/[^/?@]*:[^/?@]*@/;
const restoreTargetFrom = ({ args, env }) => {
  const fromEnv = env.RESTORE_TARGET_URL || undefined;
  const fromArgs = typeof args.uri === 'string' ? args.uri : undefined;
  if (fromEnv && fromArgs) throw new Error('Give the target in either RESTORE_TARGET_URL or --uri, not both.');
  if (fromArgs && HAS_PASSWORD.test(fromArgs)) {
    throw new Error('This --uri holds a password, and the command line is visible to other users. Put the target in RESTORE_TARGET_URL instead.');
  }
  return fromEnv ?? fromArgs;
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  Promise.resolve()
    .then(() => restore({
      archive: args.archive,
      uri: restoreTargetFrom({ args, env: process.env }),
      drop: args.drop === true,
      confirmDrop: args['confirm-drop'] === true,
    }))
    .then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
    .catch((error) => { process.stderr.write(`${scrubSecrets(error.message)}\n`); process.exitCode = 1; });
}

module.exports = { restore, restoreTargetFrom };
