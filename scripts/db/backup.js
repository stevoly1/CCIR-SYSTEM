// npm run db:backup -- --out <dir>
// Backs up the database named in MONGO_URL (hosted mongodb+srv:// or self-managed mongodb://) to a
// gzipped mongodump archive plus a manifest of per-collection counts and checksums.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { scrubSecrets } = require('../../utils/logger');
const common = require('./common');

const { parseArgs, requireTool, withToolConfig, sha256File, databaseSnapshot } = common;

// mongodump reads each collection at its own moment, so a write during the dump (a live app adds a
// refresh token at every sign-in) would leave the manifest describing a different state from the
// archive, and a later restore would fail its check. The database is therefore snapshotted before
// and after the dump; if anything changed, that archive is deleted and the backup is tried again.
const ATTEMPTS = 3;
const changedCollections = (before, after) => [...new Set([...Object.keys(before.collections), ...Object.keys(after.collections)])]
  .filter((name) => before.collections[name]?.count !== after.collections[name]?.count
    || before.collections[name]?.sha256 !== after.collections[name]?.sha256)
  .sort();

const backup = async ({ uri = process.env.MONGO_URL, out = 'backups', attempts = ATTEMPTS } = {}) => {
  if (!uri) throw new Error('MONGO_URL is not set');
  const mongodump = requireTool('mongodump');
  fs.mkdirSync(out, { recursive: true });
  let changed = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archive = path.resolve(out, `ccir-${stamp}.archive.gz`);
    const snapshot = await databaseSnapshot(uri);
    const result = await withToolConfig(uri, (config) => common.runTool(mongodump, [`--config=${config}`, `--db=${snapshot.database}`, `--archive=${archive}`, '--gzip', '--quiet']));
    if (result.status !== 0) {
      fs.rmSync(archive, { force: true });
      throw new Error(`mongodump failed: ${scrubSecrets(result.stderr.trim())}`);
    }
    changed = changedCollections(snapshot, await databaseSnapshot(uri));
    if (changed.length > 0) {
      fs.rmSync(archive, { force: true });
      continue;
    }
    const toolVersion = (await common.runTool(mongodump, ['--version'])).stdout.split('\n')[0];
    const manifest = {
      createdAt: new Date().toISOString(),
      database: snapshot.database,
      serverVersion: snapshot.serverVersion,
      toolVersion,
      archive: path.basename(archive),
      archiveSha256: sha256File(archive),
      collections: Object.fromEntries(Object.entries(snapshot.collections).map(([name, c]) => [name, { count: c.count, sha256: c.sha256 }])),
    };
    const manifestPath = archive.replace(/\.archive\.gz$/, '.manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { archive, manifestPath, manifest };
  }
  throw new Error(`The database changed while it was being backed up (${changed.join(', ')}), in each of ${attempts} attempts. No backup was kept; run it again when writes are paused.`);
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  backup({ out: args.out }).then(({ archive, manifestPath }) => process.stdout.write(`${JSON.stringify({ archive, manifest: manifestPath })}\n`))
    .catch((error) => { process.stderr.write(`${scrubSecrets(error.message)}\n`); process.exitCode = 1; });
}

module.exports = { backup };
