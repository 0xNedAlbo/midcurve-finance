/**
 * Position Wizard E2E Test (Temporary)
 *
 * Tests the complete wizard flow from opening to Step 4 (Position Config)
 *
 * Flow:
 * 1. Open wizard from dashboard
 * 2. Step 0: Click through intro
 * 3. Step 1: Select Arbitrum chain
 * 4. Step 2: Select WETH as base, USDC as quote
 * 5. Step 3: Select first available pool
 * 6. Step 4: Verify position config step opens without errors
 */

import { test, expect } from '@playwright/test';
import { captureConsoleErrors, expectNoConsoleErrors, waitForPageReady } from '../fixtures/test-helpers';
import { setupAuthenticatedSession } from '../fixtures/auth';

test.describe('Position Wizard Flow', () => {
  test('should complete wizard flow through Step 4 without errors', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    await test.step('Setup authenticated session', async () => {
      await setupAuthenticatedSession(page);
    });

    await test.step('Mock pool discovery API', async () => {
      // Mock the pool discovery endpoint to return a sample WETH/USDC pool on Arbitrum
      await page.route('**/api/v1/pools/uniswapv3/discover?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                pool: {
                  id: 'uniswapv3-42161-0x123',
                  poolType: 'uniswapv3',
                  config: {
                    chainId: 42161,
                    address: '0x1234567890123456789012345678901234567890',
                    token0: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
                    token1: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
                    feeBps: 500,
                    tickSpacing: 10,
                  },
                  state: {
                    sqrtPriceX96: '1234567890123456789012345678',
                    currentTick: 12000,
                    liquidity: '123456789012345678',
                    observationIndex: 0,
                    observationCardinality: 1,
                    observationCardinalityNext: 1,
                    feeProtocol: 0,
                    unlocked: true,
                  },
                  token0: {
                    id: 'erc20-42161-usdc',
                    tokenType: 'evm-erc20',
                    name: 'USD Coin',
                    symbol: 'USDC',
                    decimals: 6,
                    logoUrl: 'https://ethereum-optimism.github.io/data/USDC/logo.png',
                    config: {
                      chainId: 42161,
                      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  },
                  token1: {
                    id: 'erc20-42161-weth',
                    tokenType: 'evm-erc20',
                    name: 'Wrapped Ether',
                    symbol: 'WETH',
                    decimals: 18,
                    logoUrl: 'https://ethereum-optimism.github.io/data/WETH/logo.png',
                    config: {
                      chainId: 42161,
                      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  },
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                fee: 500,
                tvlUSD: 1234567.89,
                volumeUSD: 123456.78,
                feesUSD: 1234.56,
              },
            ],
          }),
        });
      });
    });

    await test.step('Navigate to dashboard', async () => {
      await page.goto('/dashboard');
      await waitForPageReady(page);
    });

    await test.step('Open position wizard', async () => {
      // Look for "Add Position" button
      const addPositionButton = page.locator('button:has-text("Add Position")');
      await expect(addPositionButton).toBeVisible({ timeout: 10000 });
      await addPositionButton.click();

      // Wait for dropdown to appear
      await page.waitForTimeout(300);

      // Click "Create New Position" option in dropdown
      const createNewButton = page.locator('button:has-text("Create New Position")');
      await expect(createNewButton).toBeVisible({ timeout: 5000 });
      await createNewButton.click();

      // Wait for wizard modal to appear
      await page.waitForTimeout(500);

      // Verify wizard opened
      const wizardTitle = page.locator('h2:has-text("Create Uniswap V3 Position")');
      await expect(wizardTitle).toBeVisible({ timeout: 5000 });
    });

    await test.step('Take screenshot of wizard intro (Step 0)', async () => {
      await page.screenshot({
        path: 'test-results/wizard-step-0-intro.png',
        fullPage: true,
      });
    });

    await test.step('Step 0: Click Next on intro screen', async () => {
      const nextButton = page.locator('button:has-text("Next")');
      await expect(nextButton).toBeVisible();
      await expect(nextButton).toBeEnabled();
      await nextButton.click();

      // Wait for step transition
      await page.waitForTimeout(300);

      // Verify we're on chain selection step
      const chainSelectionTitle = page.locator('h3:has-text("Select Blockchain")');
      await expect(chainSelectionTitle).toBeVisible();
    });

    await test.step('Take screenshot of chain selection (Step 1)', async () => {
      await page.screenshot({
        path: 'test-results/wizard-step-1-chain-selection.png',
        fullPage: true,
      });
    });

    await test.step('Step 1: Select Arbitrum chain', async () => {
      // Find and click Arbitrum chain card
      const arbitrumCard = page.locator('button:has-text("Arbitrum"), div[role="button"]:has-text("Arbitrum")').first();
      await expect(arbitrumCard).toBeVisible({ timeout: 5000 });
      await arbitrumCard.click();

      // Verify selection (card should have selected state)
      await page.waitForTimeout(300);

      // Click Next
      const nextButton = page.locator('button:has-text("Next")');
      await expect(nextButton).toBeEnabled();
      await nextButton.click();

      // Wait for step transition
      await page.waitForTimeout(300);

      // Verify we're on token pair selection
      const tokenPairTitle = page.locator('h3:has-text("Choose Token Pair")');
      await expect(tokenPairTitle).toBeVisible();
    });

    await test.step('Take screenshot of token pair selection (Step 2)', async () => {
      await page.screenshot({
        path: 'test-results/wizard-step-2-token-pair.png',
        fullPage: true,
      });
    });

    await test.step('Step 2: Select WETH as base token', async () => {
      // Look for WETH in popular tokens or search
      const wethButton = page.locator('button:has-text("WETH"), button:has-text("Wrapped Ether")').first();

      // If not in popular tokens, use search
      const isWethVisible = await wethButton.isVisible({ timeout: 2000 }).catch(() => false);

      if (!isWethVisible) {
        // Search for WETH
        const baseTokenSearch = page.locator('input[placeholder*="base" i], input[placeholder*="search" i]').first();
        await baseTokenSearch.fill('WETH');
        await page.waitForTimeout(500);
      }

      // Click WETH
      await wethButton.click();
      await page.waitForTimeout(300);
    });

    await test.step('Step 2: Select USDC as quote token', async () => {
      // Look for USDC in popular tokens or search
      const usdcButton = page.locator('button:has-text("USDC"), button:has-text("USD Coin")').first();

      // If not in popular tokens, use search
      const isUsdcVisible = await usdcButton.isVisible({ timeout: 2000 }).catch(() => false);

      if (!isUsdcVisible) {
        // Search for USDC
        const quoteTokenSearch = page.locator('input[placeholder*="quote" i], input[placeholder*="search" i]').last();
        await quoteTokenSearch.fill('USDC');
        await page.waitForTimeout(500);
      }

      // Click USDC
      await usdcButton.click();
      await page.waitForTimeout(300);

      // Click Next
      const nextButton = page.locator('button:has-text("Next")');
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();

      // Wait for step transition
      await page.waitForTimeout(500);

      // Verify we're on pool selection
      const poolSelectionTitle = page.locator('h3:has-text("Select Pool")');
      await expect(poolSelectionTitle).toBeVisible({ timeout: 10000 });
    });

    await test.step('Take screenshot of pool selection (Step 3)', async () => {
      // Wait for pools to load
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: 'test-results/wizard-step-3-pool-selection.png',
        fullPage: true,
      });
    });

    await test.step('Step 3: Select first available pool', async () => {
      // Wait for pool cards to load - look for the fee badge within the pool card button
      const poolCard = page.locator('button:has-text("0.05% Pool")').first();
      await expect(poolCard).toBeVisible({ timeout: 10000 });

      // Click first pool card
      await poolCard.click();
      await page.waitForTimeout(300);

      // Click Next
      const nextButton = page.locator('button:has-text("Next")');
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();

      // Wait for step transition to Step 4
      await page.waitForTimeout(500);
    });

    await test.step('Step 4: Verify position config step loads without errors', async () => {
      // Verify we're on position config step
      const positionConfigTitle = page.locator('h3:has-text("Configure Position")');
      await expect(positionConfigTitle).toBeVisible({ timeout: 10000 });

      // Verify price range section is visible
      const priceRangeSection = page.locator('text=/Price Range/i');
      await expect(priceRangeSection).toBeVisible({ timeout: 5000 });

      // Verify position size section is visible
      const positionSizeSection = page.locator('text=/Position Size/i');
      await expect(positionSizeSection).toBeVisible({ timeout: 5000 });

      // SUCCESS: If we got here, Step 4 loaded without crashing!
      // The main goal was to verify no "Cannot read properties of undefined" errors
    });

    await test.step('Take screenshot of position config (Step 4)', async () => {
      await page.screenshot({
        path: 'test-results/wizard-step-4-position-config.png',
        fullPage: true,
      });
    });

    await test.step('Check for console errors', async () => {
      // Allow common development warnings and expected errors
      const allowedErrors = [
        /Download the React DevTools/i,
        /webpack-internal/i,
        /Failed to load resource/i, // Some images might not load in test env
        /NetworkError/i, // API calls might fail in test env without backend
      ];

      expectNoConsoleErrors(consoleErrors, allowedErrors);
    });

    await test.step('Verify Step 4 progress indicator', async () => {
      // Verify we're on step 5 of 6 (0-indexed step 4)
      const stepIndicator = page.locator('text=/Step 5 of 6/i');
      await expect(stepIndicator).toBeVisible({ timeout: 3000 });
    });
  });

  test('should expand Position Size config without crashing', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    // Setup and navigate through wizard to Step 4
    await test.step('Setup authenticated session', async () => {
      await setupAuthenticatedSession(page);
    });

    await test.step('Mock positions list API', async () => {
      // Mock the positions list endpoint that gets called on dashboard
      await page.route('**/api/v1/positions/list?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            pagination: {
              total: 0,
              limit: 20,
              offset: 0,
            },
          }),
        });
      });
    });

    await test.step('Mock pool discovery API', async () => {
      await page.route('**/api/v1/pools/uniswapv3/discover?*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                pool: {
                  id: 'uniswapv3-42161-0x123',
                  poolType: 'uniswapv3',
                  config: {
                    chainId: 42161,
                    address: '0x1234567890123456789012345678901234567890',
                    token0: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
                    token1: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
                    feeBps: 500,
                    tickSpacing: 10,
                  },
                  state: {
                    sqrtPriceX96: '1234567890123456789012345678',
                    currentTick: 12000,
                    liquidity: '123456789012345678',
                    observationIndex: 0,
                    observationCardinality: 1,
                    observationCardinalityNext: 1,
                    feeProtocol: 0,
                    unlocked: true,
                  },
                  token0: {
                    id: 'erc20-42161-usdc',
                    tokenType: 'evm-erc20',
                    name: 'USD Coin',
                    symbol: 'USDC',
                    decimals: 6,
                    logoUrl: 'https://ethereum-optimism.github.io/data/USDC/logo.png',
                    config: {
                      chainId: 42161,
                      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  },
                  token1: {
                    id: 'erc20-42161-weth',
                    tokenType: 'evm-erc20',
                    name: 'Wrapped Ether',
                    symbol: 'WETH',
                    decimals: 18,
                    logoUrl: 'https://ethereum-optimism.github.io/data/WETH/logo.png',
                    config: {
                      chainId: 42161,
                      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  },
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                fee: 500,
                tvlUSD: 1234567.89,
                volumeUSD: 123456.78,
                feesUSD: 1234.56,
              },
            ],
          }),
        });
      });
    });

    // Navigate through wizard steps quickly
    await test.step('Navigate through wizard to Step 4', async () => {
      await page.goto('/dashboard');
      await waitForPageReady(page);

      // Open wizard
      await page.locator('button:has-text("Add Position")').click();
      await page.waitForTimeout(300);
      await page.locator('button:has-text("Create New Position")').click();
      await page.waitForTimeout(500);

      // Step 0: Click Next
      await page.locator('button:has-text("Next")').click();
      await page.waitForTimeout(300);

      // Step 1: Select Arbitrum
      await page.locator('button:has-text("Arbitrum"), div[role="button"]:has-text("Arbitrum")').first().click();
      await page.locator('button:has-text("Next")').click();
      await page.waitForTimeout(300);

      // Step 2: Select WETH and USDC
      const wethButton = page.locator('button:has-text("WETH"), button:has-text("Wrapped Ether")').first();
      await wethButton.click();
      await page.waitForTimeout(300);

      const usdcButton = page.locator('button:has-text("USDC"), button:has-text("USD Coin")').first();
      await usdcButton.click();
      await page.waitForTimeout(300);

      await page.locator('button:has-text("Next")').click();
      await page.waitForTimeout(500);

      // Step 3: Select first pool
      const poolCard = page.locator('button:has-text("0.05% Pool")').first();
      await expect(poolCard).toBeVisible({ timeout: 10000 });
      await poolCard.click();
      await page.waitForTimeout(500);

      // Take screenshot before clicking Next
      await page.screenshot({
        path: 'test-results/wizard-step-3-before-next.png',
        fullPage: true,
      });

      const nextButtonStep3 = page.locator('button:has-text("Next")');
      await expect(nextButtonStep3).toBeVisible({ timeout: 5000 });
      console.log('Clicking Next on Step 3 to go to Step 4');
      await nextButtonStep3.click();
      await page.waitForTimeout(1000);

      // Take screenshot after clicking Next
      await page.screenshot({
        path: 'test-results/wizard-step-4-arrived.png',
        fullPage: true,
      });

      // Get the page HTML for debugging
      const bodyText = await page.locator('body').textContent();
      console.log('Page content after clicking Next from Step 3:', bodyText?.substring(0, 500));

      // Verify we're on Step 4
      // Check for step indicator "Step 5 of 6" (Step 4 is actually shown as "5 of 6" because 0-indexed)
      const stepIndicator = page.locator('text=/Step.*of/i');
      const stepText = await stepIndicator.textContent().catch(() => 'not found');
      console.log('Step indicator text:', stepText);

      // Just wait a bit to see if content loads
      await page.waitForTimeout(2000);

      // Check for either "Position Size" or "Price Range" text which should be on Step 4
      const step4Content = page.locator('text=/Position Size|Price Range/i').first();
      const isVisible = await step4Content.isVisible().catch(() => false);

      if (!isVisible) {
        console.error('Step 4 content not visible. Page might have errors.');
        console.error('Current URL:', page.url());

        // Check for any error messages on page
        const errorText = await page.locator('text=/error|crash|fail/i').first().textContent().catch(() => null);
        if (errorText) {
          console.error('Error found on page:', errorText);
        }
      }

      await expect(step4Content).toBeVisible({ timeout: 10000 });

      console.log('Successfully navigated to Step 4 (Position Config)');
    });

    await test.step('Click Position Size pencil icon to expand', async () => {
      // Take screenshot before clicking
      await page.screenshot({
        path: 'test-results/wizard-step-4-before-expand.png',
        fullPage: true,
      });

      // Wait for any overlays or loading states to clear
      await page.waitForTimeout(1000);

      // Find the Position Size section row
      // It should contain "Position Size:" label and the amounts display
      const positionSizeRow = page.locator('div').filter({
        hasText: /Position Size:/i
      }).filter({
        has: page.locator('span.text-white')  // Has the white text with amounts
      }).first();

      await expect(positionSizeRow).toBeVisible({ timeout: 5000 });

      // Within that row, find the pencil/edit button (last button in the row)
      // The button contains PencilLine or PencilOff icon
      const pencilButton = positionSizeRow.locator('button').last();

      await expect(pencilButton).toBeVisible({ timeout: 5000 });

      console.log('Clicking pencil button to expand Position Size');

      // Force click to bypass any overlays
      await pencilButton.click({ force: true });
      await page.waitForTimeout(1000);

      // Take screenshot after clicking
      await page.screenshot({
        path: 'test-results/wizard-step-4-after-expand.png',
        fullPage: true,
      });
    });

    await test.step('Verify Position Size expanded without errors', async () => {
      // Check if the position size config expanded content is visible
      // Look for mode buttons or token input fields that appear when expanded
      const modeButtons = page.locator('button:has-text("Base"), button:has-text("Quote"), button:has-text("Matched")');

      // Check if at least one mode button is visible
      const hasVisibleMode = await modeButtons.first().isVisible({ timeout: 3000 }).catch(() => false);

      if (!hasVisibleMode) {
        console.error('Position Size did not expand - mode buttons not visible');

        // Capture console errors
        console.log('Console errors captured:', consoleErrors);

        throw new Error('Position Size config did not expand properly');
      }

      // Verify token amount inputs are visible
      const tokenInputs = page.locator('input[type="text"]').filter({
        has: page.locator('..').locator('text=/WETH|USDC/i'),
      });

      const inputCount = await tokenInputs.count();
      expect(inputCount).toBeGreaterThanOrEqual(1);
    });

    await test.step('Switch to Independent mode and enter 1 WETH', async () => {
      // Click the "Independent" mode button
      const independentButton = page.locator('button:has-text("Independent")');
      await expect(independentButton).toBeVisible({ timeout: 5000 });
      await independentButton.click();
      await page.waitForTimeout(500);

      // Find the WETH input field
      // Look for input that has "WETH" in its parent/sibling elements
      const wethInput = page.locator('input[type="text"]').filter({
        has: page.locator('..').locator('text=/WETH/i'),
      }).first();

      await expect(wethInput).toBeVisible({ timeout: 5000 });

      // Clear any existing value and enter 1
      await wethInput.clear();
      await wethInput.fill('1');
      await page.waitForTimeout(500);

      // Verify the value was entered
      const inputValue = await wethInput.inputValue();
      expect(inputValue).toBe('1');

      console.log('Successfully entered 1 WETH in Independent mode');

      // Take screenshot after entering amount
      await page.screenshot({
        path: 'test-results/wizard-step-4-after-amount-entry.png',
        fullPage: true,
      });
    });

    await test.step('Collapse Position Size section', async () => {
      // Find the Position Size section row
      const positionSizeRow = page.locator('div').filter({
        hasText: /Position Size:/i
      }).filter({
        has: page.locator('span.text-white')
      }).first();

      // Click the pencil button to collapse
      const pencilButton = positionSizeRow.locator('button').last();
      await pencilButton.click({ force: true });
      await page.waitForTimeout(500);

      console.log('Collapsed Position Size section');
    });

    await test.step('Expand Price Range section', async () => {
      // Find the Price Range section row
      const priceRangeRow = page.locator('div').filter({
        hasText: /Price Range:/i
      }).first();

      await expect(priceRangeRow).toBeVisible({ timeout: 5000 });

      // Find the pencil/expand button in that row
      const expandButton = priceRangeRow.locator('button').filter({
        has: page.locator('svg'),
      }).last();

      await expect(expandButton).toBeVisible({ timeout: 5000 });

      console.log('Clicking to expand Price Range section');
      await expandButton.click({ force: true });
      await page.waitForTimeout(1000);

      // Take screenshot after expanding
      await page.screenshot({
        path: 'test-results/wizard-step-4-range-expanded.png',
        fullPage: true,
      });
    });

    await test.step('Verify Price Range displays actual prices (not dashes)', async () => {
      // Check the Price Range header for actual price values
      const priceRangeText = page.locator('div').filter({
        hasText: /Price Range:/i
      }).first();

      await expect(priceRangeText).toBeVisible({ timeout: 5000 });

      // Get the text content of the price range display
      const priceRangeContent = await priceRangeText.textContent();

      console.log('Price Range display content:', priceRangeContent);

      // Check if it contains dashes (which would indicate failure)
      const hasDashes = priceRangeContent?.includes('—') || priceRangeContent?.includes('--');

      if (hasDashes) {
        console.error('Price Range still shows dashes instead of actual prices');
        console.error('Content:', priceRangeContent);

        // Take screenshot of the error state
        await page.screenshot({
          path: 'test-results/wizard-step-4-price-range-dashes.png',
          fullPage: true,
        });

        throw new Error('Price Range shows dashes (—) instead of actual price values');
      }

      // Check if it contains WETH/USDC token pair
      const hasTokenPair = priceRangeContent?.includes('WETH/USDC') || priceRangeContent?.includes('WETH');
      expect(hasTokenPair).toBeTruthy();

      // The price should contain numbers (look for digits)
      const hasNumbers = /\d/.test(priceRangeContent || '');
      expect(hasNumbers).toBeTruthy();

      console.log('✓ Price Range displays actual price values (not dashes)');
      console.log('✓ Price Range content:', priceRangeContent);
    });

    await test.step('Check for console errors and crashes', async () => {
      // Look for specific error patterns that indicate crashes
      const criticalErrors = consoleErrors.filter((errorMsg) => {
        const msg = errorMsg.toLowerCase();
        return (
          msg.includes('cannot read propert') ||
          msg.includes('undefined') ||
          msg.includes('null') ||
          msg.includes('crash') ||
          msg.includes('unhandled rejection')
        );
      });

      if (criticalErrors.length > 0) {
        console.error('Critical errors found:');
        criticalErrors.forEach((errorMsg) => {
          console.error(`  - ${errorMsg}`);
        });

        // Take screenshot of error state
        await page.screenshot({
          path: 'test-results/wizard-step-4-error-state.png',
          fullPage: true,
        });

        throw new Error(`Found ${criticalErrors.length} critical error(s) when expanding Position Size`);
      }

      // Log all console messages for debugging
      console.log(`Total console messages captured: ${consoleErrors.length}`);
      if (consoleErrors.length > 0) {
        console.log('Console messages:');
        consoleErrors.forEach((errorMsg) => {
          console.log(`  - ${errorMsg}`);
        });
      }
    });
  });
});
