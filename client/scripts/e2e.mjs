// Runs the browser journeys in Chrome, then WebKit (Safari's engine). Each browser needs its own
// run with a fresh seeded server (see playwright.config.js). Extra arguments, such as a spec file
// or --grep, go to both runs. With TEST_RESULTS_DIR set (CI), each run writes JSON results there.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECTS = ['chrome', 'webkit'];

export const buildRuns = (args, env) => PROJECTS.map((project) => ({
    project,
    args: ['test', `--project=${project}`, ...args],
    env: env.TEST_RESULTS_DIR
        ? { ...env, PLAYWRIGHT_RESULTS_FILE: path.join(env.TEST_RESULTS_DIR, `e2e-${project}.json`) }
        : { ...env },
}));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Created here rather than trusting the JSON reporter to create it.
    if (process.env.TEST_RESULTS_DIR) fs.mkdirSync(process.env.TEST_RESULTS_DIR, { recursive: true });
    for (const run of buildRuns(process.argv.slice(2), process.env)) {
        // `playwright` resolves through node_modules/.bin, which npm puts on PATH for scripts.
        const result = spawnSync('playwright', run.args, { stdio: 'inherit', env: run.env });
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
