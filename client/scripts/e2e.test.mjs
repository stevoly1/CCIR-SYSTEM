// @vitest-environment node
import path from 'node:path';
import { buildRuns } from './e2e.mjs';

describe('journey runner', () => {
    it('runs Chrome, then WebKit, passing the extra arguments to both (P3-FU-32)', () => {
        const runs = buildRuns(['tests/e2e/journeys/05-account.spec.js', '--grep', 'J6'], {});
        expect(runs.map((run) => run.args)).toEqual([
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
});
