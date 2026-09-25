const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parsePushLines, main } = require('../../scripts/ci/prePush');

// The local pre-push hook runs scripts/ci/prePush.js: the same rules as CI's check:tracked-files,
// applied to what a push would send.
const ZERO = '0'.repeat(40);
const tempDirs = [];
const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd, ...args) => {
  const result = spawnSync('git', [
    '-c', 'user.email=guard@example.test', '-c', 'user.name=Guard Test',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', ...args,
  ], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};
const commit = (dir, file, message = `add ${file}`) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), 'x');
  git(dir, 'add', '-f', file);
  git(dir, 'commit', '-qm', message);
  return git(dir, 'rev-parse', 'HEAD');
};

// A clone whose origin already holds main with the given files (clean by default).
const setup = (seedFiles = ['README.md']) => {
  const remote = tempDir('ccir-push-remote-');
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  const seed = tempDir('ccir-push-seed-');
  git(seed, 'init', '-q', '-b', 'main');
  for (const file of seedFiles) commit(seed, file);
  git(seed, 'push', '-q', remote, 'main');
  const dir = tempDir('ccir-push-local-');
  git(dir, 'clone', '-q', remote, '.');
  return { dir, remote, pushedSha: git(dir, 'rev-parse', 'HEAD') };
};
const capture = () => {
  const out = { text: '' };
  out.write = (t) => { out.text += t; };
  return out;
};
const push = (dir, lines) => {
  const stderr = capture();
  const status = main({ input: lines.join('\n') + '\n', cwd: dir, stderr });
  return { status, stderr: stderr.text };
};

describe('pre-push guard: reading what git sends', () => {
  it('reads one line per ref being pushed', () => {
    expect(parsePushLines(`refs/heads/a ${'1'.repeat(40)} refs/heads/a ${ZERO}\n\nrefs/heads/b ${'2'.repeat(40)} refs/heads/b ${'3'.repeat(40)}\n`)).toEqual([
      { localRef: 'refs/heads/a', localSha: '1'.repeat(40), remoteRef: 'refs/heads/a', remoteSha: ZERO },
      { localRef: 'refs/heads/b', localSha: '2'.repeat(40), remoteRef: 'refs/heads/b', remoteSha: '3'.repeat(40) },
    ]);
  });
});

describe('pre-push guard', () => {
  it('lets a clean push through', () => {
    const { dir, pushedSha } = setup();
    const sha = commit(dir, 'src/app.js');
    expect(push(dir, [`refs/heads/main ${sha} refs/heads/main ${pushedSha}`])).toMatchObject({ status: 0 });
  });

  it.each([
    ['docs/notes.md', 'private records'],
    ['DOCS/Notes.md', 'private records'],
    ['report/Chapter 3.docx', 'Word document'],
    ['.env', 'environment file'],
    ['config/.env.production', 'environment file'],
    ['backups/2026/manifest.json', 'database backup'],
    ['docs/a"b.md', 'private records'],
    ['docs/résumé.md', 'private records'],
  ])('refuses a push adding %s', (file, reason) => {
    const { dir, pushedSha } = setup();
    const sha = commit(dir, file);
    const result = push(dir, [`refs/heads/main ${sha} refs/heads/main ${pushedSha}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${file} (${reason})`);
    expect(result.stderr).toContain('refs/heads/main -> refs/heads/main');
  });

  it('refuses a private file added and removed within the pushed commits', () => {
    const { dir, pushedSha } = setup();
    commit(dir, 'tools/build.py');
    git(dir, 'rm', '-q', 'tools/build.py');
    git(dir, 'commit', '-qm', 'remove it');
    const sha = git(dir, 'rev-parse', 'HEAD');
    const result = push(dir, [`refs/heads/main ${sha} refs/heads/main ${pushedSha}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tools/build.py (private records)');
  });

  it('refuses a private file that only a merge commit adds', () => {
    const { dir, pushedSha } = setup();
    git(dir, 'checkout', '-qb', 'side');
    commit(dir, 'side.txt');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'main.txt');
    git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side');
    const sha = commit(dir, 'docs/merged.md', 'merge side');
    const result = push(dir, [`refs/heads/main ${sha} refs/heads/main ${pushedSha}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/merged.md (private records)');
  });

  it('refuses a nested repository added under docs/', () => {
    const { dir, pushedSha } = setup();
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${pushedSha},docs`);
    git(dir, 'commit', '-qm', 'gitlink');
    const sha = git(dir, 'rev-parse', 'HEAD');
    const result = push(dir, [`refs/heads/main ${sha} refs/heads/main ${pushedSha}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs (private records)');
  });

  // Pushing onto a branch the remote has: only the commits after the remote's are checked, so a
  // path already in the remote's history does not block every later push.
  it('checks only the commits after the remote branch when the remote has it', () => {
    const { dir, pushedSha } = setup(['README.md', 'docs/old.md']);
    const sha = commit(dir, 'src/app.js');
    expect(push(dir, [`refs/heads/main ${sha} refs/heads/main ${pushedSha}`])).toMatchObject({ status: 0 });
  });

  // A new branch is checked over its whole history, as CI checks the repository: remote-tracking
  // refs can be stale (a branch deleted on the remote), so they cannot vouch for what it holds.
  it('checks the whole history of a new branch', () => {
    const { dir } = setup();
    git(dir, 'checkout', '-qb', 'feature');
    const clean = commit(dir, 'src/feature.js');
    expect(push(dir, [`refs/heads/feature ${clean} refs/heads/feature ${ZERO}`]).status).toBe(0);
    const sha = commit(dir, 'docs/plan.md');
    const result = push(dir, [`refs/heads/feature ${sha} refs/heads/feature ${ZERO}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/plan.md (private records)');
  });

  it('refuses a new branch built on a stale remote-tracking ref that holds a private file', () => {
    const { dir } = setup();
    git(dir, 'checkout', '-qb', 'leak');
    commit(dir, 'docs/secret.md');
    git(dir, 'push', '-q', 'origin', 'leak');
    // Deleted on the remote from elsewhere; this clone keeps its unpruned origin/leak.
    git(dir, 'push', '-q', 'origin', '--delete', 'leak');
    git(dir, 'update-ref', 'refs/remotes/origin/leak', git(dir, 'rev-parse', 'leak'));
    git(dir, 'checkout', '-qb', 'again', 'origin/leak');
    const sha = commit(dir, 'src/clean.js');
    const result = push(dir, [`refs/heads/again ${sha} refs/heads/again ${ZERO}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/secret.md (private records)');
  });

  // The user's git settings must not hide a path.
  it.each([
    ['log.showRoot=false', (dir) => git(dir, 'config', 'log.showRoot', 'false')],
    ['diff.renames=true', (dir) => git(dir, 'config', 'diff.renames', 'true')],
  ])('sees a root commit whatever the setting %s', (_label, configure) => {
    const { dir } = setup();
    configure(dir);
    git(dir, 'checkout', '-q', '--orphan', 'orphan');
    git(dir, 'rm', '-rqf', '.');
    const root = commit(dir, 'docs/root.md');
    const rootResult = push(dir, [`refs/heads/orphan ${root} refs/heads/orphan ${ZERO}`]);
    expect(rootResult.status).toBe(1);
    expect(rootResult.stderr).toContain('docs/root.md (private records)');
  });

  // With log.showSignature, git log prints the signature check on stdout, glued onto the first
  // name of each signed commit with no NUL in between.
  it('sees the paths of a signed commit whatever the setting log.showSignature=true', () => {
    const { dir, pushedSha } = setup();
    const key = path.join(tempDir('ccir-push-key-'), 'key');
    const keygen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'guard', '-f', key], { encoding: 'utf8' });
    if (keygen.status !== 0) throw new Error(`ssh-keygen failed: ${keygen.stderr}`);
    git(dir, 'config', 'log.showSignature', 'true');
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs/signed.md'), 'x');
    git(dir, 'add', 'docs/signed.md');
    git(dir, '-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}`, 'commit', '-S', '-qm', 'signed');
    const result = push(dir, [`refs/heads/main ${git(dir, 'rev-parse', 'HEAD')} refs/heads/main ${pushedSha}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('  docs/signed.md (private records)');
  });

  it('sees a private path moved out of docs/ (the removal half of a rename)', () => {
    const { dir, pushedSha } = setup(['README.md', 'docs/moved.md']);
    git(dir, 'config', 'diff.renames', 'true');
    fs.mkdirSync(path.join(dir, 'src'));
    git(dir, 'mv', 'docs/moved.md', 'src/moved.md');
    git(dir, 'commit', '-qm', 'move');
    const result = push(dir, [`refs/heads/main ${git(dir, 'rev-parse', 'HEAD')} refs/heads/main ${pushedSha}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/moved.md (private records)');
  });

  it.each([
    ['diff.ignoreSubmodules=all in the user config', (dir) => git(dir, 'config', 'diff.ignoreSubmodules', 'all'), null],
    ['ignore = all in a committed .gitmodules', () => {}, '[submodule "docs"]\n\tpath = docs\n\turl = ./docs\n\tignore = all\n'],
  ])('sees a gitlink at docs whatever %s', (_label, configure, gitmodules) => {
    const { dir, pushedSha } = setup();
    configure(dir);
    if (gitmodules) fs.writeFileSync(path.join(dir, '.gitmodules'), gitmodules);
    if (gitmodules) git(dir, 'add', '.gitmodules');
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${pushedSha},docs`);
    git(dir, 'commit', '-qm', 'gitlink');
    const result = push(dir, [`refs/heads/main ${git(dir, 'rev-parse', 'HEAD')} refs/heads/main ${pushedSha}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs (private records)');
  });

  // git log on a tree or blob prints nothing, so a tag pointing at one would pass unchecked.
  it('refuses to push a tag that points at a tree rather than a commit', () => {
    const { dir } = setup();
    commit(dir, 'docs/secret.md');
    const tree = git(dir, 'rev-parse', 'HEAD^{tree}');
    const result = push(dir, [`refs/tags/treetag ${tree} refs/tags/treetag ${ZERO}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refs/tags/treetag');
    expect(result.stderr).toContain('not a commit');
  });

  it('refuses with one clear line when the guard itself fails', () => {
    const { dir } = setup();
    const result = push(dir, [`refs/heads/main ${'f'.repeat(40)} refs/heads/main ${ZERO}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^pre-push: the private-file guard failed \(.+\); push refused\. To push anyway, deliberately: git push --no-verify\n$/);
  });

  it('ignores a branch deletion and checks every other ref in the same push', () => {
    const { dir, pushedSha } = setup();
    const sha = commit(dir, '.env.local');
    const result = push(dir, [
      `(delete) ${ZERO} refs/heads/old ${pushedSha}`,
      `refs/heads/main ${sha} refs/heads/main ${pushedSha}`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.env.local (environment file)');
    expect(result.stderr).not.toContain('refs/heads/old');
  });

  // The remote's commit may be missing locally (someone else pushed): check all local history
  // the remote-tracking refs do not already hold, rather than fail.
  it('copes with a remote commit this clone does not have', () => {
    const { dir } = setup();
    const sha = commit(dir, 'docs/x.md');
    const result = push(dir, [`refs/heads/main ${sha} refs/heads/main ${'a'.repeat(40)}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/x.md (private records)');
  });
});

describe('pre-push hook wrapper', () => {
  const wrapper = path.resolve(__dirname, '../../scripts/ci/pre-push');

  it('is executable and refuses to push when the guard script is missing', () => {
    expect(fs.statSync(wrapper).mode & 0o111).not.toBe(0);
    const dir = tempDir('ccir-push-nohook-');
    git(dir, 'init', '-q');
    const result = spawnSync('sh', [wrapper, 'origin', 'https://example.test/repo.git'], { cwd: dir, input: '', encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scripts/ci/prePush.js');
    expect(result.stderr).toContain('--no-verify');
  });

  // End to end: a real git push through the installed hook, to a local bare repository.
  it('refuses a real push through the installed hook, and lets a clean one through', () => {
    const { dir } = setup();
    fs.mkdirSync(path.join(dir, 'scripts/ci'), { recursive: true });
    for (const file of ['prePush.js', 'trackedFiles.js']) {
      fs.copyFileSync(path.resolve(__dirname, '../../scripts/ci', file), path.join(dir, 'scripts/ci', file));
    }
    git(dir, 'add', 'scripts');
    git(dir, 'commit', '-qm', 'guard');
    const hooks = tempDir('ccir-push-hooks-');
    fs.copyFileSync(wrapper, path.join(hooks, 'pre-push'));
    fs.chmodSync(path.join(hooks, 'pre-push'), 0o755);
    const realPush = (...args) => spawnSync('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'maintenance.auto=false', 'push', ...args], { cwd: dir, encoding: 'utf8' });
    expect(realPush('-q', 'origin', 'main').status).toBe(0);
    commit(dir, 'docs/leak.md');
    const refused = realPush('-q', 'origin', 'main');
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('docs/leak.md (private records)');
    expect(git(dir, 'ls-remote', 'origin', 'main')).not.toContain(git(dir, 'rev-parse', 'HEAD'));
  });

  it('runs the guard with what git sends', () => {
    const { dir, pushedSha } = setup();
    fs.mkdirSync(path.join(dir, 'scripts/ci'), { recursive: true });
    for (const file of ['prePush.js', 'trackedFiles.js']) {
      fs.copyFileSync(path.resolve(__dirname, '../../scripts/ci', file), path.join(dir, 'scripts/ci', file));
    }
    const sha = commit(dir, 'docs/x.md');
    const result = spawnSync('sh', [wrapper, 'origin', 'https://example.test/repo.git'], {
      cwd: dir, input: `refs/heads/main ${sha} refs/heads/main ${pushedSha}\n`, encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/x.md (private records)');
  });
});
