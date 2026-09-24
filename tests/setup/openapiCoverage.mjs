import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { listOperations } = require('../../utils/openapi');

const readLines = (dir, suffix) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter((file) => file.endsWith(`-${suffix}.jsonl`))
  .flatMap((file) => fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));

// Fails the whole integration run when any response broke the contract, and (with
// OPENAPI_COVERAGE=enforce, set by `npm run test:integration`) when a documented operation was
// never called by any test.
// Each run records into a folder of its own, named through OPENAPI_RECORD_DIR before the test
// workers start, so two runs at once never read or clear each other's records.
export default function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccir-openapi-coverage-'));
  process.env.OPENAPI_RECORD_DIR = dir;
  return function teardown() {
    const failures = readLines(dir, 'failures');
    const called = new Set(readLines(dir, 'calls').map((entry) => entry.operation));
    const unexercised = process.env.OPENAPI_COVERAGE === 'enforce' ? listOperations().filter((op) => !called.has(op)) : [];
    fs.rmSync(dir, { recursive: true, force: true });
    const problems = [
      ...[...new Set(failures.map((f) => `Response does not match the contract: ${f.operation} ${f.status ?? ''} ${f.message}`))],
      ...unexercised.map((op) => `Documented operation never exercised by an integration test: ${op}`),
    ];
    if (problems.length) throw new Error(`OpenAPI contract check failed:\n${problems.join('\n')}`);
  };
}
