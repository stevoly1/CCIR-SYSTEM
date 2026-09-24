import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RECORD_DIR } = require('../../middleware/openapiResponseValidator');
const { listOperations } = require('../../utils/openapi');

const readLines = (suffix) => (fs.existsSync(RECORD_DIR) ? fs.readdirSync(RECORD_DIR) : [])
  .filter((file) => file.endsWith(`-${suffix}.jsonl`))
  .flatMap((file) => fs.readFileSync(path.join(RECORD_DIR, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));

// Fails the whole integration run when any response broke the contract, and (with
// OPENAPI_COVERAGE=enforce, set by `npm run test:integration`) when a documented operation was
// never called by any test.
export default function setup() {
  fs.rmSync(RECORD_DIR, { recursive: true, force: true });
  return function teardown() {
    const failures = readLines('failures');
    const called = new Set(readLines('calls').map((entry) => entry.operation));
    const unexercised = process.env.OPENAPI_COVERAGE === 'enforce' ? listOperations().filter((op) => !called.has(op)) : [];
    fs.rmSync(RECORD_DIR, { recursive: true, force: true });
    const problems = [
      ...[...new Set(failures.map((f) => `Response does not match the contract: ${f.operation} ${f.status ?? ''} ${f.message}`))],
      ...unexercised.map((op) => `Documented operation never exercised by an integration test: ${op}`),
    ];
    if (problems.length) throw new Error(`OpenAPI contract check failed:\n${problems.join('\n')}`);
  };
}
