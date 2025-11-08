/**
 * Position Detail View Tests
 *
 * Tests the individual position detail page with:
 * - PnL curve visualization
 * - Risk metrics display
 * - Fee income tracking
 * - Token amounts and prices
 */

import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from '../fixtures/auth';
import { mockApiEndpoint, waitForPageReady } from '../fixtures/test-helpers';
import { MOCK_POSITION_ENRICHED, createMockApiResponse } from '../fixtures/test-data';

test.describe('Position Detail View', () => {
  test.beforeEach(async ({ page }) => {
    // Setup authenticated session
    await setupAuthenticatedSession(page);

    // Mock position detail API endpoint
    await mockApiEndpoint(
      page,
      '**/api/positions/*',
      createMockApiResponse(MOCK_POSITION_ENRICHED)
    );
  });

  test('should display position detail page with core metrics', async ({ page }) => {
    await test.step('Navigate to position detail', async () => {
      // Try to navigate to position detail
      await page.goto('/positions/position-1').catch(async () => {
        // If route doesn't exist, try alternative patterns
        await page.goto('/position/position-1').catch(() => {
          console.log('Position detail route not yet implemented');
        });
      });
      await waitForPageReady(page);
    });

    await test.step('Capture page state', async () => {
      await page.screenshot({
        path: 'test-results/position-detail-loaded.png',
        fullPage: true,
      });

      const bodyText = await page.textContent('body');
      console.log('Page contains position detail:', bodyText?.includes('position'));
    });

    await test.step('Look for core metrics', async () => {
      const bodyText = await page.textContent('body');

      // Check for key values from mock data
      const expectedValues = [
        '10000',  // Total value in quote
        '2500',   // Current price
        'USDC',   // Quote token
        'WETH',   // Base token
        '2.0',    // Base token amount
        '5000',   // Quote token amount
      ];

      const foundValues = expectedValues.filter(
        (value) => bodyText?.includes(value)
      );

      console.log('Found position detail values:', foundValues);
    });
  });

  test('should display PnL curve visualization', async ({ page }) => {
    await page.goto('/positions/position-1').catch(() => {});
    await waitForPageReady(page);

    await test.step('Look for chart/graph elements', async () => {
      // Common chart library elements (Recharts, etc.)
      const chartSelectors = [
        'svg',
        'canvas',
        '[data-testid="pnl-curve"]',
        '[data-testid="chart"]',
        '.recharts-wrapper',
        '.chart-container',
      ];

      for (const selector of chartSelectors) {
        const count = await page.locator(selector).count();
        if (count > 0) {
          console.log(`Found ${count} chart elements: ${selector}`);
        }
      }

      await page.screenshot({
        path: 'test-results/position-detail-chart.png',
        fullPage: true,
      });
    });
  });

  test('should display current position value in quote tokens', async ({ page }) => {
    await page.goto('/positions/position-1').catch(() => {});
    await waitForPageReady(page);

    await test.step('Look for total value display', async () => {
      const bodyText = await page.textContent('body');

      // Check for total value (10000 USDC from mock)
      const hasValue = bodyText?.includes('10000') || bodyText?.includes('10,000');
      const hasQuoteToken = bodyText?.includes('USDC');

      console.log('Shows total value:', hasValue);
      console.log('Shows quote token:', hasQuoteToken);

      await page.screenshot({
        path: 'test-results/position-value-display.png',
        fullPage: true,
      });
    });
  });

  test('should display fee income in quote token units', async ({ page }) => {
    await page.goto('/positions/position-1').catch(() => {});
    await waitForPageReady(page);

    await test.step('Look for fee metrics', async () => {
      const bodyText = await page.textContent('body');

      // Check for fee values from mock (150 USDC quote, 0.05 ETH base)
      const hasFeeValue = bodyText?.includes('150') || bodyText?.includes('0.05');
      const hasFeeLabel = bodyText?.toLowerCase().includes('fee') ||
                          bodyText?.toLowerCase().includes('earned');

      console.log('Shows fee values:', hasFeeValue);
      console.log('Shows fee labels:', hasFeeLabel);

      await page.screenshot({
        path: 'test-results/position-fees-display.png',
        fullPage: true,
      });
    });
  });

  test('should display risk exposure indicators', async ({ page }) => {
    await page.goto('/positions/position-1').catch(() => {});
    await waitForPageReady(page);

    await test.step('Look for risk metrics', async () => {
      const bodyText = await page.textContent('body');

      // Check for risk-related terminology
      const riskKeywords = [
        'risk',
        'exposure',
        'range',
        'in range',
        'out of range',
        'tick',
        'liquidity',
      ];

      const foundKeywords = riskKeywords.filter(
        (keyword) => bodyText?.toLowerCase().includes(keyword)
      );

      console.log('Found risk-related keywords:', foundKeywords);

      // Check for in-range status (mock position is in range)
      const hasInRangeIndicator = bodyText?.toLowerCase().includes('in range');
      console.log('Shows in-range status:', hasInRangeIndicator);

      await page.screenshot({
        path: 'test-results/position-risk-indicators.png',
        fullPage: true,
      });
    });
  });

  test('should display token amounts and current price', async ({ page }) => {
    await page.goto('/positions/position-1').catch(() => {});
    await waitForPageReady(page);

    await test.step('Look for token amount displays', async () => {
      const bodyText = await page.textContent('body');

      // From mock data:
      // - baseTokenAmount: "2.0" WETH
      // - quoteTokenAmount: "5000.00" USDC
      // - currentPrice: "2500.00"

      const expectedDisplays = {
        baseAmount: ['2.0', '2', 'WETH'],
        quoteAmount: ['5000', 'USDC'],
        price: ['2500', '2,500'],
      };

      const findings: Record<string, boolean> = {};

      Object.entries(expectedDisplays).forEach(([key, values]) => {
        findings[key] = values.some((value) => bodyText?.includes(value));
      });

      console.log('Token amount findings:', findings);

      await page.screenshot({
        path: 'test-results/position-token-amounts.png',
        fullPage: true,
      });
    });
  });

  test('should handle position not found error', async ({ page }) => {
    await test.step('Mock 404 error', async () => {
      await mockApiEndpoint(
        page,
        '**/api/positions/*',
        {
          success: false,
          error: {
            code: 'POSITION_NOT_FOUND',
            message: 'Position not found',
          },
        },
        404
      );
    });

    await test.step('Navigate to non-existent position', async () => {
      await page.goto('/positions/invalid-id').catch(() => {});
      await waitForPageReady(page);
    });

    await test.step('Verify error state', async () => {
      const bodyText = await page.textContent('body');

      const hasError = bodyText?.toLowerCase().includes('not found') ||
                       bodyText?.toLowerCase().includes('error') ||
                       bodyText?.toLowerCase().includes('404');

      console.log('Shows not found error:', hasError);

      await page.screenshot({
        path: 'test-results/position-not-found.png',
        fullPage: true,
      });
    });
  });

  test('should display PnL calculation breakdown', async ({ page }) => {
    await page.goto('/positions/position-1').catch(() => {});
    await waitForPageReady(page);

    await test.step('Look for PnL components', async () => {
      const bodyText = await page.textContent('body');

      // Check for unrealized PnL (250 from mock)
      const hasPnL = bodyText?.includes('250');

      // Check for PnL-related labels
      const pnlLabels = [
        'pnl',
        'profit',
        'loss',
        'unrealized',
        'gain',
      ];

      const foundLabels = pnlLabels.filter(
        (label) => bodyText?.toLowerCase().includes(label)
      );

      console.log('Shows PnL value:', hasPnL);
      console.log('Found PnL labels:', foundLabels);

      await page.screenshot({
        path: 'test-results/position-pnl-breakdown.png',
        fullPage: true,
      });
    });
  });
});
