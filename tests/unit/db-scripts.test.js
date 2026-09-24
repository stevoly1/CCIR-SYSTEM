const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, assertRestoreAllowed, requireTool, withToolConfig } = require('../../scripts/db/common');

describe('database script helpers', () => {
  it('parses flags and values', () => {
    expect(parseArgs(['--out', 'backups', '--drop', '--confirm-drop'])).toEqual({ out: 'backups', drop: true, 'confirm-drop': true });
  });

  it('restores into an empty target', () => {
    expect(() => assertRestoreAllowed({ targetIsEmpty: true, drop: false, confirmDrop: false })).not.toThrow();
  });

  it.each([
    [{ targetIsEmpty: false, drop: false, confirmDrop: false }, /not empty/],
    [{ targetIsEmpty: false, drop: true, confirmDrop: false }, /--confirm-drop/],
    [{ targetIsEmpty: false, drop: false, confirmDrop: true }, /not empty/],
  ])('refuses %o', (input, message) => {
    expect(() => assertRestoreAllowed(input)).toThrow(message);
  });

  it('allows replacing a non-empty target only with both flags', () => {
    expect(() => assertRestoreAllowed({ targetIsEmpty: false, drop: true, confirmDrop: true })).not.toThrow();
  });

  it('explains how to install a missing tool', () => {
    expect(() => requireTool('definitely-not-a-mongo-tool')).toThrow(/MongoDB Database Tools/);
  });

  it('hands the tool a private config file holding the URI, and deletes it only after the tool finishes', async () => {
    const uri = 'mongodb+srv://app:Config-Pass-1@cluster.example.net/ccir';
    let seen;
    await expect(withToolConfig(uri, async (file) => {
      seen = file;
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(file, 'utf8')).toBe(`uri: ${JSON.stringify(uri)}\n`);
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(fs.existsSync(file)).toBe(true);
      throw new Error('tool failed');
    })).rejects.toThrow('tool failed');
    expect(fs.existsSync(seen)).toBe(false);
  });

  it('runs a tool without blocking and reports its status and output', async () => {
    const { runTool } = require('../../scripts/db/common');
    const ticks = [];
    const timer = setInterval(() => ticks.push(Date.now()), 5);
    const result = await runTool(process.execPath, ['-e', "setTimeout(() => { process.stdout.write('out'); process.stderr.write('err'); process.exit(3); }, 100)"]);
    clearInterval(timer);
    expect(result).toEqual({ status: 3, stdout: 'out', stderr: 'err' });
    expect(ticks.length).toBeGreaterThan(3);
  });

  // Backups hold personal data; they must never be committable to the public repository.
  it.each(['backups/ccir-2026-01-01.archive.gz', 'backups/ccir-2026-01-01.manifest.json', 'nested/ccir-x.archive.gz'])(
    'keeps %s out of git',
    (file) => {
      const root = path.resolve(__dirname, '..', '..');
      expect(spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: root }).status).toBe(0);
    },
  );

  // The private records repository is nested at docs/; nothing in it may enter this public one.
  it('keeps the private records folder out of git', () => {
    const root = path.resolve(__dirname, '..', '..');
    expect(spawnSync('git', ['check-ignore', '-q', '--no-index', 'docs/remediation/any-record.md'], { cwd: root }).status).toBe(0);
  });

  describe('restore refusals that happen before any database or tool is touched', () => {
    const { restore } = require('../../scripts/db/restore');
    let dir;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-restore-test-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('requires an explicit target and never falls back to MONGO_URL', async () => {
      vi.stubEnv('MONGO_URL', 'mongodb://should-not-be-used.example.test/ccir');
      await expect(restore({ archive: path.join(dir, 'x.archive.gz') })).rejects.toThrow(/--uri are required; the target is never taken from MONGO_URL/);
      vi.unstubAllEnvs();
    });

    it('refuses an archive that does not match its manifest checksum', async () => {
      const archive = path.join(dir, 'ccir-test.archive.gz');
      fs.writeFileSync(archive, 'tampered bytes');
      fs.writeFileSync(archive.replace(/\.archive\.gz$/, '.manifest.json'), JSON.stringify({ archiveSha256: 'f'.repeat(64), database: 'ccir', collections: {} }));
      await expect(restore({ archive, uri: 'mongodb://127.0.0.1:9/never-contacted' })).rejects.toThrow('does not match its manifest checksum');
    });
  });
});
