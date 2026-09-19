import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend-unit',
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 5000,
    hookTimeout: 10000,
  },
});
