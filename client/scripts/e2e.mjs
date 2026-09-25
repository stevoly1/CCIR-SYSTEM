// Runs the browser journeys in Chrome, then WebKit: `npm run test:e2e -- [spec file] [--grep x]`.
// The details live in e2eRuns.mjs. This file does nothing but start them, so it needs no
// "was I started directly?" check, which fails when the path contains a symlink.
import { run } from './e2eRuns.mjs';

process.exitCode = run(process.argv.slice(2), process.env);
