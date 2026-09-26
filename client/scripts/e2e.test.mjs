// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, buildRuns, run } from './e2eRuns.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tempDirs = [];
const tempDir = (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
};
afterAll(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('journey runner', () => {
    it('runs a chosen spec file once per browser, Chrome then WebKit, passing the extra arguments to both', () => {
        const runs = buildRuns(['tests/e2e/journeys/05-account.spec.js', '--grep', 'J6'], {});
        expect(runs.map((r) => r.args)).toEqual([
            ['test', '--project=chrome', 'tests/e2e/journeys/05-account.spec.js', '--grep', 'J6'],
            ['test', '--project=webkit', 'tests/e2e/journeys/05-account.spec.js', '--grep', 'J6'],
        ]);
    });

    it('runs each group with a fresh server per browser, core first', () => {
        const runs = buildRuns([], {});
        expect(runs.map((r) => [r.group, r.project])).toEqual([['core', 'chrome'], ['core', 'webkit'], ['queue', 'chrome'], ['queue', 'webkit']]);
        expect(runs[0].args).toEqual(['test', '--project=chrome', ...GROUPS[0].filters]);
        expect(runs[2].args).toEqual(['test', '--project=chrome', 'tests/e2e/journeys/09-']);
    });

    it('puts every journey in exactly one group', () => {
        const journeys = fs.readdirSync(path.join(here, '..', 'tests', 'e2e', 'journeys')).filter((file) => file.endsWith('.spec.js'));
        const specs = ['tests/e2e/login.smoke.spec.js', ...journeys.map((file) => `tests/e2e/journeys/${file}`)];
        const filters = GROUPS.flatMap((group) => group.filters);
        for (const spec of specs) expect(filters.filter((filter) => spec.startsWith(filter)), spec).toHaveLength(1);
    });

    it('lets a flag-only filter leave a group empty without failing', () => {
        const runs = buildRuns(['--grep', 'J1'], {});
        expect(runs).toHaveLength(4);
        for (const r of runs) expect(r.args.slice(-3)).toEqual(['--grep', 'J1', '--pass-with-no-tests']);
    });

    it('names a results file per group and browser when TEST_RESULTS_DIR is set, and none otherwise', () => {
        const runs = buildRuns([], { TEST_RESULTS_DIR: '/tmp/results', KEEP: '1' });
        expect(runs[0].env).toMatchObject({ KEEP: '1' });
        expect(runs.map((r) => path.basename(r.env.PLAYWRIGHT_RESULTS_FILE))).toEqual(['e2e-core-chrome.json', 'e2e-core-webkit.json', 'e2e-queue-chrome.json', 'e2e-queue-webkit.json']);
        expect(path.basename(buildRuns(['tests/e2e/journeys/05-account.spec.js'], { TEST_RESULTS_DIR: '/tmp/results' })[0].env.PLAYWRIGHT_RESULTS_FILE)).toBe('e2e-chrome.json');
        expect(buildRuns([], { KEEP: '1' })[0].env).not.toHaveProperty('PLAYWRIGHT_RESULTS_FILE');
    });

    it('runs both browsers and returns 0 when both pass', () => {
        const calls = [];
        expect(run(['x.spec.js'], {}, (bin, args) => { calls.push([bin, args]); return { status: 0 }; })).toBe(0);
        // A chosen spec file: one run per browser.
        expect(calls.map(([bin, args]) => [bin, args[1]])).toEqual([['playwright', '--project=chrome'], ['playwright', '--project=webkit']]);
    });

    it('stops at the first failing browser and returns a failing code', () => {
        const calls = [];
        expect(run([], {}, (bin, args) => { calls.push(args); return { status: 3 }; })).toBe(3);
        expect(calls).toHaveLength(1);
        // Killed by a signal, or playwright could not start.
        expect(run([], {}, () => ({ status: null }))).toBe(1);
    });

    it('creates the results folder before any browser runs', () => {
        const dir = path.join(tempDir('ccir-e2e-'), 'not', 'yet');
        expect(run([], { TEST_RESULTS_DIR: dir }, () => {
            expect(fs.existsSync(dir)).toBe(true);
            return { status: 0 };
        })).toBe(0);
    });

    // Node does not resolve symlinks in process.argv[1], so a "was I started directly?" check fails
    // through a symlinked path and the runner used to exit 0 having run nothing.
    it('runs the journeys when started through a symlinked path', () => {
        const bin = tempDir('ccir-e2e-bin-');
        const log = path.join(bin, 'calls.log');
        fs.writeFileSync(path.join(bin, 'playwright'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
        const link = path.join(tempDir('ccir-e2e-link-'), 'scripts');
        fs.symlinkSync(here, link);
        const result = spawnSync(process.execPath, [path.join(link, 'e2e.mjs'), '--grep', 'J1'], {
            env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_RESULTS_DIR: '' },
            encoding: 'utf8',
        });
        expect(result.status).toBe(0);
        const expected = GROUPS.flatMap((group) => ['chrome', 'webkit'].map((project) => `test --project=${project} ${group.filters.join(' ')} --grep J1 --pass-with-no-tests\n`)).join('');
        expect(fs.readFileSync(log, 'utf8')).toBe(expected);
    });
});
