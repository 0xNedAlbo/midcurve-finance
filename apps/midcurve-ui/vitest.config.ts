import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Include API E2E tests
    include: ['src/app/api/**/*.e2e.test.ts'],

    // Use Node environment for API tests
    environment: 'node',

    // Global setup file
    setupFiles: ['src/test/global-setup.ts'],

    // Globals enabled for describe, it, expect, etc.
    globals: true,

    // Test timeout
    testTimeout: 30000,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
