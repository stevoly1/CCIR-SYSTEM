const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { privateReason, findPrivatePaths, main } = require('../../scripts/ci/trackedFiles');

// The public repository never holds private records, environment files, Word files or database
// backups. CI checks every tracked path and every path in history.
const tempDirs = [];
const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('private-file guard', () => {
  it.each([
    ['.env', 'environment file'],
    ['.env.local', 'environment file'],
    ['client/.env.production', 'environment file'],
    ['docs/remediation/x.md', 'private records'],
    ['tools/build.py', 'private records'],
    ['report/Chapter 3.docx', 'Word document'],
    ['A.DOCX', 'Word document'],
    ['backups/2026-09-25/manifest.json', 'database backup'],
    ['snapshot.archive.gz', 'database backup'],
    // A gitlink (a nested repository added with git add or git submodule add) is listed bare.
    ['docs', 'private records'],
    ['tools', 'private records'],
    // macOS file systems ignore case: .ENV is the same file as .env.
    ['.ENV', 'environment file'],
    ['client/.Env.Local', 'environment file'],
    ['DOCS/x.md', 'private records'],
    ['Tools/x.py', 'private records'],
    ['Backups/x.json', 'database backup'],
    ['x.ARCHIVE.GZ', 'database backup'],
    // Other common homes for environment values.
    ['.envrc', 'environment file'],
    ['config/production.env', 'environment file'],
    ['.env-local', 'environment file'],
    ['client/.env_prod', 'environment file'],
    ['.env~', 'environment file'],
    ['.env copy', 'environment file'],
    ['.env (1)', 'environment file'],
    ['.env#', 'environment file'],
    ['.env+old', 'environment file'],
  ])('refuses %s', (path, reason) => {
    expect(privateReason(path)).toBe(reason);
  });

  it.each(['.env.example', 'client/.env.example', '.ENV.EXAMPLE', 'README.md', 'scripts/db/backup.js', 'client/src/docs-link.jsx', 'tests/fixtures/documents.js', 'envelope.js', 'docsite/a.md', 'toolsets.js', 'src/environment.js', 'dotenv.js', '.envoy.yaml', 'client/.env.example'])(
    'accepts %s',
    (path) => {
      expect(privateReason(path)).toBeNull();
    },
  );

  it('lists each private path once, sorted, with its reason', () => {
    expect(findPrivatePaths(['tools/a', 'README.md', '.env', 'tools/a'])).toEqual([
      { path: '.env', reason: 'environment file' },
      { path: 'tools/a', reason: 'private records' },
    ]);
  });
});

describe('private-file guard command', () => {
  const { spawnSync } = require('node:child_process');
  const script = path.resolve(__dirname, '../../scripts/ci/trackedFiles.js');
  // Independent of this machine's git settings: a global signing key or hooks path must not make
  // a commit fail silently.
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result;
  };
  const repo = () => {
    const dir = tempDir('ccir-guard-');
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'guard@example.test');
    git(dir, 'config', 'user.name', 'Guard Test');
    return dir;
  };
  const commit = (dir, file, message) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'x');
    git(dir, 'add', file);
    git(dir, 'commit', '-qm', message);
  };
  // In-process, so coverage measures it; one test below runs the real command.
  const run = (dir) => {
    let stdout = '';
    let stderr = '';
    const status = main({ cwd: dir, stdout: { write: (t) => { stdout += t; } }, stderr: { write: (t) => { stderr += t; } } });
    return { status, stdout, stderr };
  };

  it('passes a clean repository, from the command line too', () => {
    const dir = repo();
    commit(dir, 'README.md', 'readme');
    expect(run(dir)).toMatchObject({ status: 0, stdout: expect.stringContaining('no private paths') });
    expect(spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
  });

  it('fails on a private path that a later commit removed', () => {
    const dir = repo();
    commit(dir, 'docs/notes.md', 'add notes');
    git(dir, 'rm', '-q', 'docs/notes.md');
    git(dir, 'commit', '-qm', 'remove notes');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/notes.md (private records)');
  });

  // Git quotes non-ASCII paths by default ("docs/\303\251.md"), which would slip past ^docs/.
  it('catches a private path whose name is not plain ASCII', () => {
    const dir = repo();
    commit(dir, 'docs/résumé.md', 'add');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/résumé.md (private records)');
  });

  // core.quotePath=false does not help here: git still quotes names holding a quote, a backslash,
  // a tab or a newline ("docs/a\\"b.md"), which would slip past ^docs/.
  it.each(['docs/a"b.md', 'docs/a\\b.md', 'docs/a\tb.md', 'docs/a\nb.md'])('catches the private path %j, which git would quote', (name) => {
    const dir = repo();
    commit(dir, name, 'add');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${name} (private records)`);
  });

  it('catches a nested repository added under docs/ as a gitlink', () => {
    const dir = repo();
    commit(dir, 'README.md', 'readme');
    const head = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${head},docs`);
    git(dir, 'commit', '-qm', 'gitlink');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs (private records)');
  });

  // git log lists no files for a merge commit unless asked (-m): a private file added while
  // resolving one merge and removed by another would otherwise leave no trace the guard can see.
  it('catches a private path added and removed only by merge commits', () => {
    const dir = repo();
    // A setting that turns merge diffs into combined diffs must not change what the guard sees.
    git(dir, 'config', 'log.diffMerges', 'cc');
    commit(dir, 'README.md', 'readme');
    const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    git(dir, 'checkout', '-qb', 'side');
    commit(dir, 'side.txt', 'side');
    git(dir, 'checkout', '-q', base);
    commit(dir, 'main.txt', 'main');
    git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side');
    commit(dir, 'docs/merged.md', 'merge side, adding a private file');
    git(dir, 'checkout', '-qb', 'side2');
    commit(dir, 'side2.txt', 'side2');
    git(dir, 'checkout', '-q', base);
    commit(dir, 'main2.txt', 'main2');
    git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side2');
    git(dir, 'rm', '-q', 'docs/merged.md');
    git(dir, 'commit', '-qm', 'merge side2, removing it');
    expect(git(dir, 'ls-files').stdout).not.toContain('docs/');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/merged.md (private records)');
  });

  // With log.showRoot=false and rename detection on, a file the root commit added under docs/ and
  // a later commit moved elsewhere would appear nowhere: the root commit is hidden and the move is
  // shown as the new path only. The guard pins both settings.
  it('sees a private path the root commit added and a later commit moved, whatever the settings', () => {
    const dir = repo();
    git(dir, 'config', 'log.showRoot', 'false');
    git(dir, 'config', 'diff.renames', 'true');
    commit(dir, 'docs/first.md', 'root');
    fs.mkdirSync(path.join(dir, 'src'));
    git(dir, 'mv', 'docs/first.md', 'src/first.md');
    git(dir, 'commit', '-qm', 'move it');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/first.md (private records)');
  });

  it('refuses a shallow clone, which would hide history', () => {
    const source = repo();
    commit(source, 'a.txt', 'one');
    commit(source, 'b.txt', 'two');
    const shallow = tempDir('ccir-guard-shallow-');
    git(source, 'clone', '-q', '--depth', '1', `file://${source}`, shallow);
    const result = run(shallow);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('full history');
  });
});
