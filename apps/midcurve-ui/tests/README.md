# Playwright Visual UI Testing for Midcurve Finance

This directory contains Playwright E2E tests for the Midcurve Finance UI, designed to enable **visual test-driven development** and collaborative debugging between developers and AI assistants.

## Philosophy: Visual Testing for Investigation

Unlike traditional test suites that aim for 100% coverage, these tests are designed to be **run on-demand** to investigate specific UI flows and issues. The goal is to:

1. **"See" what the UI does** - Generate screenshots, videos, and traces
2. **Share visual artifacts** - Enable developer ↔ AI collaboration
3. **Document expected behavior** - Tests serve as living documentation
4. **Debug issues faster** - Time-travel debugging with trace viewer

## Quick Start

### Run All Tests

```bash
# Run all tests (headless mode)
npm run test:e2e

# Run with browser visible
npm run test:e2e:headed

# Run in interactive UI mode (recommended for development)
npm run test:e2e:ui

# Run in debug mode (step through tests)
npm run test:e2e:debug
```

### Run Specific Tests

```bash
# Run specific test file
npm run test:e2e tests/health/basic-navigation.spec.ts

# Run tests matching a pattern
npm run test:e2e -- --grep "position detail"

# Run tests for a specific flow
npm run test:e2e tests/positions/
```

### View Test Results

```bash
# Open HTML report with traces
npm run test:report

# Open specific trace file
npm run test:trace test-results/trace.zip
```

## Test Organization

```
tests/
├── auth/
│   └── siwe-signin.spec.ts          # SIWE wallet authentication
├── positions/
│   ├── position-list.spec.ts        # Position list view
│   ├── position-detail.spec.ts      # Position detail with PnL curve
│   └── position-import.spec.ts      # Import positions from wallet
├── pools/
│   └── (future pool tests)
├── health/
│   └── basic-navigation.spec.ts     # Homepage and basic navigation
└── fixtures/
    ├── auth.ts                      # Authentication helpers
    ├── test-data.ts                 # Mock positions, pools, tokens
    └── test-helpers.ts              # Utility functions
```

## Test Fixtures

### Authentication (`fixtures/auth.ts`)

```typescript
import { setupAuthenticatedSession } from '../fixtures/auth';

test.beforeEach(async ({ page }) => {
  await setupAuthenticatedSession(page);
});
```

### Mock Data (`fixtures/test-data.ts`)

```typescript
import { MOCK_POSITION_LIST, createMockApiResponse } from '../fixtures/test-data';

await mockApiEndpoint(
  page,
  '**/api/positions',
  createMockApiResponse(MOCK_POSITION_LIST)
);
```

### Helper Utilities (`fixtures/test-helpers.ts`)

```typescript
import {
  waitForPageReady,
  mockApiEndpoint,
  takeScreenshot,
  captureConsoleErrors
} from '../fixtures/test-helpers';
```

## Visual Artifacts

Every test generates visual artifacts automatically:

### Screenshots

- **When**: Automatically on test failure
- **Where**: `test-results/*.png`
- **Manually**: `await page.screenshot({ path: 'name.png', fullPage: true })`

### Videos

- **When**: Automatically on test failure
- **Where**: `test-results/*.webm`
- **Format**: WebM video of entire test run

### Trace Files

- **When**: Automatically on test failure
- **Where**: `test-results/trace.zip`
- **Contains**: Film strip timeline, DOM snapshots, network logs, console output, source code

## Trace Viewer: The Killer Feature

The trace viewer provides **time-travel debugging** for tests:

### Opening Trace Viewer

```bash
# Method 1: From HTML report
npm run test:report
# Click the trace icon next to any test

# Method 2: Direct file
npm run test:trace test-results/trace.zip

# Method 3: Online viewer (for sharing)
# Upload trace.zip to https://trace.playwright.dev
```

### What You'll See

1. **Film Strip Timeline** - Screenshots at every action
2. **DOM Snapshots** - Inspect element state at any point
3. **Network Activity** - All API requests/responses
4. **Console Logs** - All browser console output
5. **Source Code** - Which test line executed each action

### Example Workflow

**Scenario:** Position PnL calculation looks wrong

1. **Developer runs test:**
   ```bash
   npm run test:e2e tests/positions/position-detail.spec.ts
   ```

2. **Test fails → generates trace**
   ```
   test-results/
   ├── trace.zip
   ├── video.webm
   └── screenshot.png
   ```

3. **Developer opens trace viewer:**
   ```bash
   npm run test:report
   ```

4. **Developer captures screenshots:**
   - Film strip showing PnL calculation step
   - DOM snapshot showing rendered values
   - Network tab showing API response

5. **Share with AI:**
   - Upload screenshots to chat
   - AI can see exact UI state, data flow, and errors
   - Collaborative debugging begins!

## Developer ↔ AI Collaboration Pattern

### 1. Investigate UI Issue

```bash
# Run the relevant flow test
npm run test:e2e:headed tests/positions/position-detail.spec.ts
```

### 2. Generate Visual Evidence

Test automatically creates:
- Screenshots at each step (via `test.step()`)
- Full trace file with timeline
- Video recording of test execution

### 3. Share with AI Assistant

Upload to chat:
- Screenshot from trace viewer showing failure point
- Screenshot of network tab with API response
- Screenshot of DOM showing rendered values

### 4. AI Analyzes Visuals

AI can see:
- Exact UI state when issue occurred
- What data the API returned
- How components rendered that data
- Console errors (if any)

### 5. Implement Fix

Based on visual evidence, implement fix in codebase.

### 6. Verify Fix

```bash
# Re-run test to verify
npm run test:e2e:headed tests/positions/position-detail.spec.ts
```

## Writing New Tests

### Test Structure Pattern

```typescript
import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from '../fixtures/auth';
import { mockApiEndpoint, waitForPageReady } from '../fixtures/test-helpers';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Setup (auth, mocks, etc.)
    await setupAuthenticatedSession(page);
  });

  test('should do something specific', async ({ page }) => {
    await test.step('Step 1: Navigate', async () => {
      await page.goto('/some-page');
      await waitForPageReady(page);
    });

    await test.step('Step 2: Interact', async () => {
      await page.click('button');
      await expect(page.locator('h1')).toBeVisible();
    });

    await test.step('Step 3: Capture evidence', async () => {
      await page.screenshot({
        path: 'test-results/feature-state.png',
        fullPage: true,
      });
    });
  });
});
```

### Best Practices

1. **Use `test.step()` for clear trace sections**
   - Each step appears separately in trace viewer
   - Makes debugging easier

2. **Take screenshots liberally**
   - Visual evidence is the whole point
   - Screenshot after key interactions

3. **Mock API endpoints**
   - Consistent test data
   - Fast test execution
   - No backend dependency

4. **Capture console errors**
   ```typescript
   const errors = captureConsoleErrors(page);
   // ... test code ...
   expectNoConsoleErrors(errors);
   ```

5. **Use descriptive test names**
   - "should display position PnL in quote tokens"
   - NOT "test position page"

## Test Execution Modes

### Headless Mode (Default)

```bash
npm run test:e2e
```

- Fast execution
- No browser window
- Perfect for CI/CD

### Headed Mode

```bash
npm run test:e2e:headed
```

- Browser window visible
- Watch tests execute in real-time
- Great for understanding flow

### UI Mode (Interactive)

```bash
npm run test:e2e:ui
```

- Interactive test selection
- Time-travel debugging
- Live trace viewer
- **Best for development**

### Debug Mode

```bash
npm run test:e2e:debug
```

- Pauses at each action
- Step through tests line-by-line
- Inspect page state manually

## Configuration

See [playwright.config.ts](../playwright.config.ts) for:

- Base URL and port configuration
- Artifact capture settings
- Browser/device configurations
- Timeout settings
- Web server integration

## CI/CD Integration

Tests can run in GitHub Actions:

```yaml
# .github/workflows/playwright.yml
name: Playwright Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Troubleshooting

### Tests Timing Out

Increase timeout in `playwright.config.ts`:

```typescript
timeout: 60 * 1000, // 60 seconds
```

### Port Already in Use

Change port in `.env` or `playwright.config.ts`:

```typescript
const PORT = 3001; // Use different port
```

### Trace File Too Large

Disable video for passing tests:

```typescript
video: 'retain-on-failure', // Only keep failed test videos
```

### Flaky Tests

Add explicit waits:

```typescript
await page.waitForLoadState('networkidle');
await page.waitForSelector('[data-testid="element"]');
```

## Current Test Coverage

### ✅ Implemented Tests

1. **Health Check** (`tests/health/basic-navigation.spec.ts`)
   - Homepage loads
   - Landing page sections visible
   - Sign in/signup modals open
   - Mobile responsive

2. **Authentication** (`tests/auth/siwe-signin.spec.ts`)
   - Auth modal display
   - Session persistence
   - Error handling
   - Redirect after login

3. **Position List** (`tests/positions/position-list.spec.ts`)
   - Position cards/table display
   - Quote token values
   - In-range status indicators
   - PnL display
   - Empty state
   - Error state

4. **Position Detail** (`tests/positions/position-detail.spec.ts`)
   - Core metrics display
   - PnL curve visualization
   - Fee income tracking
   - Risk exposure indicators
   - Token amounts and prices
   - Error handling

5. **Position Import** (`tests/positions/position-import.spec.ts`)
   - Wallet address input
   - Position discovery
   - Selection interface
   - Import confirmation
   - Validation errors
   - Empty results

### 🔮 Future Tests

- Pool discovery and search
- Token enrichment display
- Multi-wallet linking
- API key management
- Settings and preferences
- Visual regression testing

## Tips for AI Assistants

When analyzing test results:

1. **Look at screenshots first** - Visual state tells the story
2. **Check network tab in trace** - API responses drive UI state
3. **Inspect DOM snapshots** - See rendered HTML/CSS
4. **Read console logs** - Catch React errors and warnings
5. **Compare expected vs actual** - Test assertions show intent

## Additional Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Trace Viewer Guide](https://playwright.dev/docs/trace-viewer)
- [Visual Comparisons](https://playwright.dev/docs/test-snapshots)

---

**Last Updated:** 2025-10-23

**Maintained by:** Midcurve Finance Team

**Questions?** Check test output screenshots or ask for help with specific flows!
