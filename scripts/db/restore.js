// npm run db:restore -- --archive <file> --uri <target> [--drop --confirm-drop]
// Restores a db:backup archive into the database named in --uri. The target is never taken from
// MONGO_URL, a non-empty target is refused unless --drop --confirm-drop are both given, and the
// restored collections are checked against the backup manifest.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { scrubSecrets } = require('../../utils/logger');
const { parseArgs, assertRestoreAllowed, requireTool, withToolConfig, runTool, sha256File, databaseSnapshot } = require('./common');

const restore = async ({ archive, uri, drop = false, confirmDrop = false }) => {
  if (!archive || !uri) throw new Error('Both --archive and --uri are required; the target is never taken from MONGO_URL.');
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
  const after = await databaseSnapshot(uri);
  const mismatches = Object.entries(manifest.collections)
    .filter(([name, c]) => after.collections[name]?.count !== c.count || after.collections[name]?.sha256 !== c.sha256)
    .map(([name]) => name);
  if (mismatches.length) throw new Error(`Restored collections differ from the manifest: ${mismatches.join(', ')}`);
  return { database: after.database, collections: Object.keys(manifest.collections).length };
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  restore({ archive: args.archive, uri: args.uri, drop: args.drop === true, confirmDrop: args['confirm-drop'] === true })
    .then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
    .catch((error) => { process.stderr.write(`${scrubSecrets(error.message)}\n`); process.exitCode = 1; });
}

module.exports = { restore };
