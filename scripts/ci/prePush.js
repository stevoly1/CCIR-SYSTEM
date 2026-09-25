// Local pre-push guard: refuses a push whose new commits add, change or remove a private path
// (docs/, tools/, Word files, environment files, database backups). It uses the rules of CI's
// check:tracked-files (trackedFiles.js), so the two cannot drift apart, and reads names the same way:
// NUL-separated, merge commits included. CI remains the enforcement point; this catches a mistake
// before it leaves the machine. Installed by copying scripts/ci/pre-push to .git/hooks/pre-push.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { findPrivatePaths, gitPaths } = require('./trackedFiles');

const ZERO = /^0+$/;

// Git writes one line per ref: <local ref> <local sha> <remote ref> <remote sha>.
const parsePushLines = (input) => input
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(' ');
    return { localRef, localSha, remoteRef, remoteSha };
  });

const commitExists = (cwd, sha) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// The commits this push would send: after the remote's commit when this clone has it; otherwise
// (a new branch, or a remote commit fetched by nobody here) everything the remote-tracking refs
// do not already hold.
const newCommits = ({ cwd, remote, localSha, remoteSha }) => (!ZERO.test(remoteSha) && commitExists(cwd, remoteSha)
  ? [`${remoteSha}..${localSha}`]
  : [localSha, '--not', `--remotes=${remote}`]);

// Returns the exit code. Options exist so the tests can run it in-process.
const main = ({
  args = process.argv.slice(2),
  input = fs.readFileSync(0, 'utf8'),
  cwd = process.cwd(),
  stderr = process.stderr,
} = {}) => {
  const [remote] = args;
  let status = 0;
  for (const { localRef, localSha, remoteRef, remoteSha } of parsePushLines(input)) {
    if (ZERO.test(localSha)) continue; // a deletion sends no commits
    const range = newCommits({ cwd, remote, localSha, remoteSha });
    const found = findPrivatePaths(gitPaths(['log', '--diff-merges=first-parent', '--name-only', '--format=', ...range], cwd));
    if (found.length === 0) continue;
    status = 1;
    stderr.write(`pre-push: refusing to push ${localRef} -> ${remoteRef}; private paths in the commits being pushed:\n`);
    for (const { path, reason } of found) stderr.write(`  ${path} (${reason})\n`);
  }
  return status;
};

if (require.main === module) process.exitCode = main();

module.exports = { parsePushLines, main };
