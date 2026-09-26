// How the browser journeys run: Chrome, then WebKit (Safari's engine), each run against a fresh
// seeded server (see playwright.config.js). The journeys run in groups, each group once per
// browser, so no group outgrows the sign-in limit: 20 sign-ins per 15 minutes per address, and every
// journey signs in from 127.0.0.1. A spec-file argument runs just that, once per browser; other
// arguments (such as --grep) go to every run, and a group the filter leaves empty does not fail.
// With TEST_RESULTS_DIR set (CI), each run writes JSON results there.
// Kept apart from e2e.mjs so the tests can import it without starting any journeys.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PROJECTS = ['chrome', 'webkit'];

export const GROUPS = [
    { name: 'core', filters: ['tests/e2e/login.smoke', 'tests/e2e/journeys/harness', ...['01', '02', '03', '04', '05', '06', '07', '08'].map((n) => `tests/e2e/journeys/${n}-`)] },
    { name: 'queue', filters: ['tests/e2e/journeys/09-'] },
];

// An argument that looks like a path picks spec files.
const selectsFiles = (args) => args.some((arg) => !arg.startsWith('-') && /[\\/]|\.spec\.js$/.test(arg));

export const buildRuns = (args, env) => {
    const picked = selectsFiles(args);
    const groups = picked ? [{ name: null, filters: [] }] : GROUPS;
    const extra = !picked && args.length > 0 ? ['--pass-with-no-tests'] : [];
    return groups.flatMap((group) => PROJECTS.map((project) => ({
        group: group.name,
        project,
        args: ['test', `--project=${project}`, ...group.filters, ...args, ...extra],
        env: env.TEST_RESULTS_DIR
            ? { ...env, PLAYWRIGHT_RESULTS_FILE: path.join(env.TEST_RESULTS_DIR, `e2e-${group.name ? `${group.name}-` : ''}${project}.json`) }
            : { ...env },
    })));
};

// Returns the exit code: the first failing run's, or 0 when every run passes.
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
