// npm run db:backup -- --out <dir>
// Backs up the database named in MONGO_URL (hosted mongodb+srv:// or self-managed mongodb://) to a
// gzipped mongodump archive plus a manifest of per-collection counts and checksums.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { scrubSecrets } = require('../../utils/logger');
const { parseArgs, requireTool, withToolConfig, runTool, sha256File, databaseSnapshot } = require('./common');

const backup = async ({ uri = process.env.MONGO_URL, out = 'backups' } = {}) => {
  if (!uri) throw new Error('MONGO_URL is not set');
  const mongodump = requireTool('mongodump');
  fs.mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = path.resolve(out, `ccir-${stamp}.archive.gz`);
  const snapshot = await databaseSnapshot(uri);
  const result = await withToolConfig(uri, (config) => runTool(mongodump, [`--config=${config}`, `--db=${snapshot.database}`, `--archive=${archive}`, '--gzip', '--quiet']));
  if (result.status !== 0) throw new Error(`mongodump failed: ${scrubSecrets(result.stderr.trim())}`);
  const toolVersion = (await runTool(mongodump, ['--version'])).stdout.split('\n')[0];
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
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  backup({ out: args.out }).then(({ archive, manifestPath }) => process.stdout.write(`${JSON.stringify({ archive, manifest: manifestPath })}\n`))
    .catch((error) => { process.stderr.write(`${scrubSecrets(error.message)}\n`); process.exitCode = 1; });
}

module.exports = { backup };
