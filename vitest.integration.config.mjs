import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend-integration',
    include: ['tests/integration/**/*.test.js'],
    environment: 'node',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    setupFiles: ['./tests/setup/integration.mjs'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
