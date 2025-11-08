import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for Midcurve Finance UI
 *
 * This configuration enables visual UI testing with rich debugging artifacts:
 * - Screenshots on failure
 * - Video recordings on failure
 * - Interactive trace files for time-travel debugging
 *
 * See https://playwright.dev/docs/test-configuration
 */

const PORT = process.env.PORT || 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  // Test directory
  testDir: './tests',

  // Maximum time one test can run for
  timeout: 30 * 1000,

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI (for stability)
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ['html', {
      outputFolder: 'playwright-report',
      open: 'never' // Don't auto-open on CI
    }],
    ['list'], // Console output during test run
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL,

    // Collect trace when retrying the failed test
    trace: 'retain-on-failure',

    // Capture screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on failure
    video: 'retain-on-failure',

    // Maximum time each action such as `click()` can take
    actionTimeout: 10 * 1000,

    // Navigation timeout
    navigationTimeout: 30 * 1000,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use device viewport
        viewport: { width: 1280, height: 720 },
      },
    },

    // Uncomment to test on Firefox
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // Uncomment to test on WebKit (Safari)
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    // Uncomment to test mobile viewports
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 14 Pro'] },
    // },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes to start dev server
    stdout: 'ignore',
    stderr: 'pipe',
  },

  // Output directory for test artifacts (screenshots, videos, traces)
  outputDir: 'test-results',
});
