import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Test projects for workspace-style separation
    projects: [
      // Unit tests - fast, mocked dependencies
      {
        test: {
          name: 'unit',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.integration.{test,spec}.{js,ts}', 'node_modules', 'dist', 'temp'],
          environment: 'node',
          globals: true,
          env: {
            LOG_LEVEL: 'silent',
          },
        },
      },
      // Integration tests - real database
      // Note: Environment variables loaded from .env.test via --env-file flag (see package.json)
      {
        test: {
          name: 'integration',
          include: ['src/**/*.integration.{test,spec}.{js,ts}'],
          exclude: ['node_modules', 'dist', 'temp'],
          environment: 'node',
          globals: true,
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
          // Run tests sequentially to ensure proper database isolation
          // and avoid race conditions with database cleanup
          sequence: {
            concurrent: false,
          },
          // Limit concurrency for integration tests to ensure proper rate limiting
          // RequestScheduler is shared across CoinGeckoClient instances, so we need
          // to run tests sequentially to avoid overwhelming the CoinGecko API
          pool: 'forks',
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
          globalSetup: './src/test/global-setup.ts',
          setupFiles: ['./src/test/setup-integration.ts'],
          // Override specific env vars (others loaded from .env.test)
          env: {
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
          },
        },
      },
    ],

    // Default coverage settings (applies to all projects)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['dist/**', 'temp/**', '**/*.d.ts', 'src/test/**'],
    },
  },
});
