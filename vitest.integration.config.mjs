import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend-integration',
    include: ['tests/integration/**/*.test.js'],
    environment: 'node',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    // Environment and global stubs never leak from one test into the next.
    unstubEnvs: true,
    unstubGlobals: true,
    fileParallelism: false,
    setupFiles: ['./tests/setup/integration.mjs'],
    testTimeout: 30000,
    // A clean machine may need to download the pinned MongoDB test binary once.
    hookTimeout: 600000,
  },
});
