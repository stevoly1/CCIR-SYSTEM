const fs = require('node:fs');
const path = require('node:path');
const { listOperations } = require('../../utils/openapi');

const CLIENT_SRC = path.resolve(__dirname, '..', '..', 'client', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return /\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
});
const normalise = (route) => route.split('?')[0].replace(/\$\{[^}]+\}/g, '{param}').replace(/\{[^}]+\}/g, '{param}');
const sources = () => walk(CLIENT_SRC).map((file) => ({ file: path.relative(CLIENT_SRC, file), source: fs.readFileSync(file, 'utf8') }));

const clientCalls = () => sources().flatMap(({ file, source }) => {
  const calls = [...source.matchAll(/axiosClient\.(get|post|put|patch|delete)\(\s*([`'"])(.+?)\2/g)]
    .map(([, method, , route]) => ({ file, operation: `${method.toUpperCase()} ${normalise(route)}` }));
  if (/\/auth\/google(?:[`'"?]|\$\{)/.test(source)) calls.push({ file, operation: 'GET /auth/google' });
  return calls;
});

describe('reference client and contract', () => {
  it('finds the client API calls', () => {
    expect(clientCalls().length).toBeGreaterThanOrEqual(35);
  });

  it('finds the Google sign-in link, with or without a return path', () => {
    expect(clientCalls()).toContainEqual({ file: path.join('components', 'GoogleButton.jsx'), operation: 'GET /auth/google' });
  });

  it('calls only documented operations', () => {
    const documented = new Set(listOperations().map((op) => { const [m, r] = op.split(' '); return `${m} ${normalise(r)}`; }));
    const undocumented = clientCalls().filter((call) => !documented.has(call.operation));
    expect(undocumented).toEqual([]);
  });

  // The scan above reads axiosClient calls with literal paths. Any other way of calling the API
  // would escape it, so it fails here instead.
  it('makes every API call through axiosClient with a literal path', () => {
    const escapes = sources().flatMap(({ file, source }) => [
      ...[...source.matchAll(/\bfetch\(|\baxios\.(get|post|put|patch|delete|request)\(|axiosClient\(|axiosClient\.request\(/g)].map(([match]) => `${file}: ${match}`),
      ...[...source.matchAll(/axiosClient\.(get|post|put|patch|delete)\(\s*(?![`'"])/g)].map(([match]) => `${file}: ${match} (non-literal path)`),
    ]);
    expect(escapes).toEqual([]);
  });
});

// Operations the web client has no reason to call. Each needs a reason; anything else the API
// documents must have a client screen, so no capability is left without a way to use it.
const API_ONLY = new Map([
  ['GET /auth/google/callback', 'Google redirects the browser here after sign-in; the client never calls it'],
  ['GET /health', 'operations probe'],
  ['GET /health/live', 'operations probe'],
  ['GET /health/ready', 'operations probe'],
  ['GET /docs', 'the published contract, for people'],
  ['GET /openapi.json', 'the published contract, for tools'],
  ['GET /categories/{id}', 'the category list already carries every field the client shows'],
]);
const normalisedOperation = (op) => { const [m, r] = op.split(' '); return `${m} ${normalise(r)}`; };

describe('reference client covers the contract', () => {
  it('calls every documented operation, apart from the API-only ones', () => {
    const called = new Set(clientCalls().map((call) => call.operation));
    const apiOnly = new Set([...API_ONLY.keys()].map(normalisedOperation));
    const unused = listOperations().filter((op) => !called.has(normalisedOperation(op)) && !apiOnly.has(normalisedOperation(op)));
    expect(unused).toEqual([]);
  });

  it('keeps the API-only list to operations that exist and that the client does not call', () => {
    const documented = new Set(listOperations().map(normalisedOperation));
    const called = new Set(clientCalls().map((call) => call.operation));
    for (const op of API_ONLY.keys()) {
      expect(documented.has(normalisedOperation(op)), `${op} is not documented`).toBe(true);
      expect(called.has(normalisedOperation(op)), `${op} is called by the client; remove it from API_ONLY`).toBe(false);
    }
  });
});
