import path from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

// Journeys run against the real API (tests/e2e-server/start.mjs) with deterministic
// provider fakes; the smoke test stubs its own network and needs no backend state.
//
// The client is the production build (served by `vite preview`), as users get it, built into a
// temporary folder so the working `dist/` is never touched.
//
// Journeys share one seeded server and build on each other's data, so each browser needs a run
// of its own with a fresh server: `npm run test:e2e` (scripts/e2e.mjs) runs Chrome, then WebKit
// (Safari's engine, which caught the blank docs page that Chrome did not).
const BUILD_DIR = path.join(tmpdir(), 'ccir-e2e-client');

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: path.join(tmpdir(), 'ccir-playwright-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A test.only left in a commit would run one journey and pass: CI refuses it.
  forbidOnly: Boolean(process.env.CI),
  // CI asks for machine-readable results (scripts/e2e.mjs sets the file per browser) so that a
  // skipped or flaky journey fails the run (scripts/ci/checkTestResults.js).
  reporter: process.env.PLAYWRIGHT_RESULTS_FILE
    ? [['line'], ['json', { outputFile: process.env.PLAYWRIGHT_RESULTS_FILE }]]
    : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: 'node ../tests/e2e-server/start.mjs',
      env: { NODE_ENV: 'test' },
      url: 'http://127.0.0.1:8181/api/v1/health',
      reuseExistingServer: false,
      timeout: 180000,
    },
    {
      command: `npx vite build --outDir "${BUILD_DIR}" --emptyOutDir && npx vite preview --outDir "${BUILD_DIR}" --host 127.0.0.1 --port 4173 --strictPort`,
      env: { VITE_API_URL: 'http://127.0.0.1:8181/api/v1' },
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
