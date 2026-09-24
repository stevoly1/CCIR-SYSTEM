import { defineConfig } from 'vitest/config';

// One run over both backend projects, so coverage reflects unit and integration tests together.
// Each project keeps its own settings (setup files, timeouts, sequential integration files).
export default defineConfig({
  test: {
    projects: ['./vitest.unit.config.mjs', './vitest.integration.config.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'app.js', 'server.js', 'config/**', 'controllers/**', 'errors/**', 'handlers/**', 'middleware/**', 'models/**',
        'policies/**', 'presenters/**', 'routes/**', 'scripts/**', 'services/**', 'utils/**', 'validators/**',
      ],
    },
  },
});
