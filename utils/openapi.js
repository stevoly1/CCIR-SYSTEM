const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const CONTRACT_PATH = path.resolve(__dirname, '..', 'openapi', 'openapi.yaml');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

let cached;
// Parsed once and cached: the contract is read-only at run time.
const getContract = () => {
  cached ??= YAML.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  return cached;
};

// Operations as "METHOD /path", with paths relative to the /api/v1 server.
const listOperations = (contract = getContract()) => Object.entries(contract.paths)
  .flatMap(([route, item]) => Object.keys(item).filter((method) => METHODS.includes(method)).map((method) => `${method.toUpperCase()} ${route}`));

module.exports = { CONTRACT_PATH, getContract, listOperations };
