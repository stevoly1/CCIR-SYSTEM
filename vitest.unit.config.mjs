import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend-unit',
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup/unit.mjs'],
    clearMocks: true,
    restoreMocks: true,
    // Environment and global stubs never leak from one test into the next.
    unstubEnvs: true,
    unstubGlobals: true,
    testTimeout: 5000,
    hookTimeout: 10000,
  },
});
