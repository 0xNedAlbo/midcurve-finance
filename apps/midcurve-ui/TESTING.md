# Playwright Testing - Quick Reference

## Most Common Commands

```bash
# Run tests with browser visible (easiest to see what's happening)
npm run test:e2e:headed

# Run tests in interactive UI mode (best for development)
npm run test:e2e:ui

# Run specific test file
npm run test:e2e tests/health/basic-navigation.spec.ts

# View test results and traces
npm run test:report
```

## The Trace Viewer Workflow

**This is the most powerful feature for debugging!**

### 1. Run a Test

```bash
npm run test:e2e:headed tests/positions/position-detail.spec.ts
```

### 2. Test Fails → Artifacts Generated

```
test-results/
├── trace.zip          ← The golden file!
├── video.webm         ← Screen recording
└── screenshot.png     ← Snapshot at failure
```

### 3. Open Trace Viewer

```bash
npm run test:report
```

Click the 🔍 trace icon next to the failed test.

### 4. What You Get

- **Film strip timeline** - See every step visually
- **DOM snapshots** - Inspect HTML at any moment
- **Network logs** - All API calls with request/response
- **Console output** - All errors and logs
- **Source code** - Which line executed each action

### 5. Share with AI

Take screenshots of the trace viewer showing:
- The failure point in the timeline
- The network request/response
- The DOM state
- Any console errors

Upload to chat → collaborative debugging!

## Test Structure

```typescript
test('should do something', async ({ page }) => {
  await test.step('Step 1: Setup', async () => {
    await page.goto('/page');
  });

  await test.step('Step 2: Action', async () => {
    await page.click('button');
  });

  await test.step('Step 3: Verify + Screenshot', async () => {
    await expect(page.locator('h1')).toBeVisible();
    await page.screenshot({ path: 'test-results/result.png', fullPage: true });
  });
});
```

## Mock API Data

```typescript
import { mockApiEndpoint } from '../fixtures/test-helpers';
import { MOCK_POSITION_LIST, createMockApiResponse } from '../fixtures/test-data';

// Mock an endpoint
await mockApiEndpoint(
  page,
  '**/api/positions',
  createMockApiResponse(MOCK_POSITION_LIST)
);
```

## Authentication

```typescript
import { setupAuthenticatedSession } from '../fixtures/auth';

test.beforeEach(async ({ page }) => {
  await setupAuthenticatedSession(page);
});
```

## Available Tests

| Test File | What It Tests |
|-----------|---------------|
| `tests/health/basic-navigation.spec.ts` | Homepage, landing page, basic navigation |
| `tests/auth/siwe-signin.spec.ts` | Wallet auth flow, session persistence |
| `tests/positions/position-list.spec.ts` | Position list, quote values, PnL |
| `tests/positions/position-detail.spec.ts` | Position detail, PnL curve, fees |
| `tests/positions/position-import.spec.ts` | Import flow, wallet discovery |

## Running Specific Tests

```bash
# All tests in a directory
npm run test:e2e tests/positions/

# Tests matching a name pattern
npm run test:e2e -- --grep "position detail"

# Single test file
npm run test:e2e tests/health/basic-navigation.spec.ts

# Run only tests with .only()
npm run test:e2e -- --grep "@only"
```

## Debugging Tips

### 1. See the Browser

```bash
npm run test:e2e:headed
```

### 2. Pause and Inspect

```bash
npm run test:e2e:debug
```

### 3. Add Manual Pause

```typescript
await page.pause(); // Test pauses here, opens inspector
```

### 4. Slow Down

```typescript
use: {
  launchOptions: {
    slowMo: 1000, // Slow down by 1 second per action
  },
}
```

### 5. Screenshot Everything

```typescript
await test.step('Capture state', async () => {
  await page.screenshot({
    path: 'test-results/debug-state.png',
    fullPage: true,
  });
});
```

## Common Patterns

### Wait for Page Ready

```typescript
import { waitForPageReady } from '../fixtures/test-helpers';

await page.goto('/page');
await waitForPageReady(page);
```

### Capture Console Errors

```typescript
import { captureConsoleErrors, expectNoConsoleErrors } from '../fixtures/test-helpers';

const errors = captureConsoleErrors(page);
// ... test code ...
expectNoConsoleErrors(errors);
```

### Fill Form Field

```typescript
import { fillFormField } from '../fixtures/test-helpers';

await fillFormField(page, 'input[name="address"]', '0x1234...');
```

### Mock Error Response

```typescript
import { createMockApiError } from '../fixtures/test-data';

await mockApiEndpoint(
  page,
  '**/api/positions/*',
  createMockApiError('POSITION_NOT_FOUND', 'Position not found'),
  404
);
```

## When to Use Which Mode

| Mode | Use When |
|------|----------|
| **Headless** (`test:e2e`) | Running in CI/CD, batch testing |
| **Headed** (`test:e2e:headed`) | Want to watch test execute |
| **UI Mode** (`test:e2e:ui`) | Interactive development, picking tests |
| **Debug** (`test:e2e:debug`) | Need to step through line-by-line |
| **Trace Viewer** (`test:report`) | Test failed, need to investigate |

## Pro Tips

1. **Use test.step()** - Creates clear sections in trace viewer
2. **Screenshot liberally** - Visual evidence is the goal
3. **Name tests clearly** - "should display PnL in quote tokens"
4. **Mock API calls** - Fast, consistent, no backend needed
5. **Use data-testid** - More stable than CSS classes
6. **Check console errors** - Catch React warnings early

## File Locations

```
midcurve-ui/
├── tests/                      # Test files
│   ├── fixtures/              # Reusable helpers and data
│   ├── auth/                  # Auth flow tests
│   ├── positions/             # Position tests
│   ├── pools/                 # Pool tests
│   └── health/                # Basic health checks
├── test-results/              # Generated artifacts (gitignored)
├── playwright-report/         # HTML report (gitignored)
├── playwright.config.ts       # Configuration
└── TESTING.md                 # This file!
```

## Troubleshooting

### Port Already in Use

```bash
# Change PORT in playwright.config.ts or:
PORT=3001 npm run test:e2e
```

### Test Timeout

```typescript
// In playwright.config.ts
timeout: 60 * 1000, // Increase to 60 seconds
```

### Can't Find Element

```typescript
// Wait explicitly
await page.waitForSelector('[data-testid="element"]');

// Or check if it exists first
const count = await page.locator('[data-testid="element"]').count();
if (count > 0) {
  await page.click('[data-testid="element"]');
}
```

### Flaky Tests

```typescript
// Add retry logic in playwright.config.ts
retries: 2,
```

---

**Next Steps:**

1. Run the basic health check: `npm run test:e2e:headed tests/health/basic-navigation.spec.ts`
2. Open trace viewer: `npm run test:report`
3. Explore the interactive UI mode: `npm run test:e2e:ui`
4. Try debugging a test: `npm run test:e2e:debug tests/positions/position-list.spec.ts`

**Full Documentation:** See [tests/README.md](tests/README.md)
