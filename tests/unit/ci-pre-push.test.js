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
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
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

// A clone whose origin already has one clean commit on main.
const setup = () => {
  const remote = tempDir('ccir-push-remote-');
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  const seed = tempDir('ccir-push-seed-');
  git(seed, 'init', '-q', '-b', 'main');
  commit(seed, 'README.md');
  git(seed, 'push', '-q', remote, 'main');
  const dir = tempDir('ccir-push-local-');
  git(dir, 'clone', '-q', remote, '.');
  return { dir, pushedSha: git(dir, 'rev-parse', 'HEAD') };
};
const capture = () => {
  const out = { text: '' };
  out.write = (t) => { out.text += t; };
  return out;
};
const push = (dir, lines) => {
  const stderr = capture();
  const status = main({ args: ['origin', 'https://example.test/repo.git'], input: lines.join('\n') + '\n', cwd: dir, stderr });
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

  // A new branch: only the commits the remote does not have yet are checked.
  it('checks only the new commits of a new branch', () => {
    const { dir } = setup();
    git(dir, 'checkout', '-qb', 'feature');
    const clean = commit(dir, 'src/feature.js');
    expect(push(dir, [`refs/heads/feature ${clean} refs/heads/feature ${ZERO}`]).status).toBe(0);
    const sha = commit(dir, 'docs/plan.md');
    const result = push(dir, [`refs/heads/feature ${sha} refs/heads/feature ${ZERO}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/plan.md (private records)');
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
