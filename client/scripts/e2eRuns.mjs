// How the browser journeys run: Chrome, then WebKit (Safari's engine). Each browser needs its own
// run with a fresh seeded server (see playwright.config.js). Extra arguments, such as a spec file
// or --grep, go to both runs. With TEST_RESULTS_DIR set (CI), each run writes JSON results there.
// Kept apart from e2e.mjs so the tests can import it without starting any journeys.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PROJECTS = ['chrome', 'webkit'];

export const buildRuns = (args, env) => PROJECTS.map((project) => ({
    project,
    args: ['test', `--project=${project}`, ...args],
    env: env.TEST_RESULTS_DIR
        ? { ...env, PLAYWRIGHT_RESULTS_FILE: path.join(env.TEST_RESULTS_DIR, `e2e-${project}.json`) }
        : { ...env },
}));

// Returns the exit code: the first failing browser's, or 0 when both pass.
export const run = (args, env, spawn = spawnSync) => {
    // Created here rather than trusting the JSON reporter to create it.
    if (env.TEST_RESULTS_DIR) fs.mkdirSync(env.TEST_RESULTS_DIR, { recursive: true });
    for (const { args: runArgs, env: runEnv } of buildRuns(args, env)) {
        // `playwright` resolves through node_modules/.bin, which npm puts on PATH for scripts.
        const result = spawn('playwright', runArgs, { stdio: 'inherit', env: runEnv });
        if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
};
