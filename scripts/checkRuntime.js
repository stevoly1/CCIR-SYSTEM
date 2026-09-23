const NODE_MINIMUM = [26, 9, 0];
const NODE_MAXIMUM = [27, 0, 0];
const NPM_MINIMUM = [12, 1, 0];
const NPM_MAXIMUM = [13, 0, 0];

const parseVersion = (value) => {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
};

const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
};

const describeRange = (minimum, maximum) => `>=${minimum.join('.')} <${maximum[0]}`;

const satisfies = (version, minimum, maximum) => {
  const parsed = parseVersion(version);
  return parsed !== null
    && compareVersions(parsed, minimum) >= 0
    && compareVersions(parsed, maximum) < 0;
};

const argumentValue = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

const npmVersionFromEnvironment = () => {
  const match = process.env.npm_config_user_agent?.match(/(?:^|\s)npm\/([^\s]+)/);
  return match?.[1] || null;
};

const nodeVersion = argumentValue('--node') || process.versions.node;
const npmVersion = argumentValue('--npm') || npmVersionFromEnvironment();
const errors = [];

if (!satisfies(nodeVersion, NODE_MINIMUM, NODE_MAXIMUM)) {
  errors.push(`Unsupported Node.js ${nodeVersion}; required ${describeRange(NODE_MINIMUM, NODE_MAXIMUM)}.`);
}

if (!satisfies(npmVersion, NPM_MINIMUM, NPM_MAXIMUM)) {
  errors.push(`Unsupported npm ${npmVersion || 'unknown'}; required ${describeRange(NPM_MINIMUM, NPM_MAXIMUM)}.`);
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Node.js ${nodeVersion} and npm ${npmVersion} satisfy the CCIR runtime contract.\n`,
  );
}
