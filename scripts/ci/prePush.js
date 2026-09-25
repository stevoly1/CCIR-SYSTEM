// Local pre-push guard: refuses a push whose new commits add, change or remove a private path
// (docs/, tools/, Word files, environment files, database backups). It uses the rules and the
// history reader of CI's check:tracked-files (trackedFiles.js), so the two cannot drift apart.
// CI remains the enforcement point; this catches a mistake before it leaves the machine.
// Installed from scripts/ci/pre-push (see the README).
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { findPrivatePaths, historyPaths } = require('./trackedFiles');

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

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const commitExists = (cwd, sha) => {
  try {
    git(cwd, 'cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

// The commits to check: after the remote's commit when this clone has it; otherwise (a new branch,
// or a remote commit nobody here fetched) the whole history, as CI checks it. Remote-tracking refs
// cannot vouch for what the remote holds: they go stale when a branch is deleted there.
const commitsToCheck = (cwd, localSha, remoteSha) => (!ZERO.test(remoteSha) && commitExists(cwd, remoteSha)
  ? [`${remoteSha}..${localSha}`]
  : [localSha]);

const refusals = (cwd, { localRef, localSha, remoteRef, remoteSha }) => {
  // git log on a tree or blob prints nothing, so only commits (or tags of commits) can be checked.
  const type = git(cwd, 'cat-file', '-t', `${localSha}^{}`);
  if (type !== 'commit') return [`pre-push: refusing to push ${localRef} -> ${remoteRef}: it points at a ${type}, not a commit, which the guard cannot check.\n`];
  const found = findPrivatePaths(historyPaths(cwd, ...commitsToCheck(cwd, localSha, remoteSha)));
  if (found.length === 0) return [];
  return [
    `pre-push: refusing to push ${localRef} -> ${remoteRef}; private paths in the commits being pushed:\n`,
    ...found.map(({ path, reason }) => `  ${path} (${reason})\n`),
  ];
};

// Returns the exit code. Options exist so the tests can run it in-process.
const main = ({ input, cwd = process.cwd(), stderr = process.stderr } = {}) => {
  try {
    const messages = parsePushLines(input ?? fs.readFileSync(0, 'utf8'))
      .filter(({ localSha }) => !ZERO.test(localSha)) // a deletion sends no commits
      .flatMap((ref) => refusals(cwd, ref));
    for (const message of messages) stderr.write(message);
    return messages.length > 0 ? 1 : 0;
  } catch (error) {
    stderr.write(`pre-push: the private-file guard failed (${String(error.message).split('\n')[0]}); push refused. To push anyway, deliberately: git push --no-verify\n`);
    return 1;
  }
};

if (require.main === module) process.exitCode = main();

module.exports = { parsePushLines, main };
