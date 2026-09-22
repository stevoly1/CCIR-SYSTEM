import path from 'node:path';
import { tmpdir } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

// Journeys run against the real API (tests/e2e-server/start.mjs) with deterministic
// provider fakes; the smoke test stubs its own network and needs no backend state.
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: path.join(tmpdir(), 'ccir-playwright-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
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
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      env: { VITE_API_URL: 'http://127.0.0.1:8181/api/v1' },
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
