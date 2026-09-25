// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRuns, run } from './e2eRuns.mjs';

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
    it('runs Chrome, then WebKit, passing the extra arguments to both', () => {
        const runs = buildRuns(['tests/e2e/journeys/05-account.spec.js', '--grep', 'J6'], {});
        expect(runs.map((r) => r.args)).toEqual([
            ['test', '--project=chrome', 'tests/e2e/journeys/05-account.spec.js', '--grep', 'J6'],
            ['test', '--project=webkit', 'tests/e2e/journeys/05-account.spec.js', '--grep', 'J6'],
        ]);
    });

    it('names a results file per browser when TEST_RESULTS_DIR is set, and none otherwise', () => {
        const [chrome, webkit] = buildRuns([], { TEST_RESULTS_DIR: '/tmp/results', KEEP: '1' });
        expect(chrome.env).toMatchObject({ KEEP: '1', PLAYWRIGHT_RESULTS_FILE: path.join('/tmp/results', 'e2e-chrome.json') });
        expect(webkit.env.PLAYWRIGHT_RESULTS_FILE).toBe(path.join('/tmp/results', 'e2e-webkit.json'));
        expect(buildRuns([], { KEEP: '1' })[0].env).not.toHaveProperty('PLAYWRIGHT_RESULTS_FILE');
    });

    it('runs both browsers and returns 0 when both pass', () => {
        const calls = [];
        expect(run(['x.spec.js'], {}, (bin, args) => { calls.push([bin, args]); return { status: 0 }; })).toBe(0);
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
        expect(fs.readFileSync(log, 'utf8')).toBe('test --project=chrome --grep J1\ntest --project=webkit --grep J1\n');
    });
});
