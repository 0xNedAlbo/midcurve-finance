/**
 * NFT Import E2E Tests
 *
 * Tests the "Import NFT by ID" functionality in the CreatePositionDropdown component.
 * Verifies that users can import positions from the blockchain using chain ID and NFT token ID.
 */

import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from '../fixtures/auth';
import { waitForPageReady } from '../fixtures/test-helpers';

test.describe('Import NFT by ID', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authenticated session (required for dashboard access)
    await setupAuthenticatedSession(page);
  });

  test('should successfully import Arbitrum NFT 4973304', async ({ page }) => {
    await test.step('Navigate to dashboard', async () => {
      await page.goto('/dashboard');
      await waitForPageReady(page);
    });

    await test.step('Verify dashboard loads with CreatePositionDropdown', async () => {
      // Check that the "Your Positions" heading is visible
      const heading = page.locator('h2:has-text("Your Positions")');
      await expect(heading).toBeVisible();

      // Check that the "Add Position" button is visible
      const addPositionButton = page.locator('button:has-text("Add Position")');
      await expect(addPositionButton).toBeVisible();
    });

    await test.step('Click Add Position button to open dropdown', async () => {
      const addPositionButton = page.locator('button:has-text("Add Position")');
      await addPositionButton.click();

      // Wait for dropdown to appear
      await page.waitForTimeout(200);
    });

    await test.step('Verify dropdown menu is visible', async () => {
      // Check for the three menu options
      const createNewOption = page.locator('text=Create New Position');
      const importWalletOption = page.locator('text=Import From Wallet');
      const importNftOption = page.locator('text=Import NFT by ID');

      await expect(createNewOption).toBeVisible();
      await expect(importWalletOption).toBeVisible();
      await expect(importNftOption).toBeVisible();

      // Take screenshot of dropdown menu
      await page.screenshot({
        path: 'test-results/import-nft-dropdown-menu.png',
        fullPage: true,
      });
    });

    await test.step('Click "Import NFT by ID" to expand form', async () => {
      const importNftOption = page.locator('button:has-text("Import NFT by ID")');
      await importNftOption.click();

      // Wait for form to expand
      await page.waitForTimeout(200);
    });

    await test.step('Verify NFT import form is visible', async () => {
      // Check for form fields
      const blockchainLabel = page.locator('label:has-text("Blockchain")');
      const nftIdLabel = page.locator('label:has-text("NFT Token ID")');
      const importButton = page.locator('button:has-text("Import Position")');

      await expect(blockchainLabel).toBeVisible();
      await expect(nftIdLabel).toBeVisible();
      await expect(importButton).toBeVisible();

      // Take screenshot of expanded form
      await page.screenshot({
        path: 'test-results/import-nft-form-expanded.png',
        fullPage: true,
      });
    });

    await test.step('Mock the API import endpoint BEFORE filling form', async () => {
      // Mock the POST /api/v1/positions/uniswapv3/import endpoint
      // This needs to be set up before we click the import button
      await page.route('**/api/v1/positions/uniswapv3/import', async (route) => {
        const request = route.request();
        const postData = request.postDataJSON();

        // Verify request payload - nftId is sent as number by the hook
        expect(postData.chainId).toBe(42161); // Arbitrum
        expect(postData.nftId).toBe(4973304); // Number, not string

        // Add a small delay to simulate network request
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Return mock successful response
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'test-position-id',
              protocol: 'uniswapv3',
              positionType: 'CL_TICKS',
              positionHash: 'uniswapv3/42161/4973304',
              userId: 'test-user-id',
              currentValue: '1500000000',
              currentCostBasis: '1000000000',
              realizedPnl: '0',
              unrealizedPnl: '500000000',
              collectedFees: '25000000',
              unClaimedFees: '5000000',
              lastFeesCollectedAt: new Date().toISOString(),
              priceRangeLower: '1500000000',
              priceRangeUpper: '2000000000',
              isToken0Quote: true,
              positionOpenedAt: new Date().toISOString(),
              positionClosedAt: null,
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              pool: {
                id: 'test-pool-id',
                token0: {
                  id: 'test-token0-id',
                  symbol: 'USDC',
                  name: 'USD Coin',
                  decimals: 6,
                },
                token1: {
                  id: 'test-token1-id',
                  symbol: 'WETH',
                  name: 'Wrapped Ether',
                  decimals: 18,
                },
              },
              config: {
                chainId: 42161,
                nftId: 4973304,
                poolAddress: '0x...',
              },
              state: {
                liquidity: '1000000',
                tickLower: -887220,
                tickUpper: 887220,
              },
            },
          }),
        });
      });
    });

    await test.step('Select Arbitrum from blockchain dropdown', async () => {
      const blockchainSelect = page.locator('select').first();
      await blockchainSelect.selectOption('arbitrum');

      // Verify selection
      const selectedValue = await blockchainSelect.inputValue();
      expect(selectedValue).toBe('arbitrum');
    });

    await test.step('Enter NFT Token ID: 4973304', async () => {
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await nftIdInput.fill('4973304');

      // Verify input
      const inputValue = await nftIdInput.inputValue();
      expect(inputValue).toBe('4973304');

      // Take screenshot with filled form
      await page.screenshot({
        path: 'test-results/import-nft-form-filled.png',
        fullPage: true,
      });
    });

    await test.step('Click Import Position button', async () => {
      const importButton = page.locator('button:has-text("Import Position")');
      await importButton.click();
    });

    await test.step('Verify loading state appears', async () => {
      // Check for loading spinner
      const loadingButton = page.locator('button:has-text("Importing...")');
      await expect(loadingButton).toBeVisible();

      // Button should be disabled during import
      await expect(loadingButton).toBeDisabled();

      // Take screenshot of loading state
      await page.screenshot({
        path: 'test-results/import-nft-loading.png',
        fullPage: true,
      });
    });

    await test.step('Wait for import success and verify success message', async () => {
      // Wait for success message to appear
      const successMessage = page.locator('text=Import Successful!');
      await expect(successMessage).toBeVisible({ timeout: 5000 });

      // Verify NFT ID is mentioned in success message
      const nftIdInMessage = page.locator('text=NFT 4973304');
      await expect(nftIdInMessage).toBeVisible();

      // Take screenshot of success state
      await page.screenshot({
        path: 'test-results/import-nft-success.png',
        fullPage: true,
      });
    });

    await test.step('Verify dropdown auto-closes after success', async () => {
      // Wait for auto-close (2 second delay in component)
      await page.waitForTimeout(2500);

      // Dropdown should be closed
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await expect(nftIdInput).not.toBeVisible();

      // Take screenshot showing closed dropdown
      await page.screenshot({
        path: 'test-results/import-nft-closed.png',
        fullPage: true,
      });
    });

    await test.step('Verify position appears in list (if list is implemented)', async () => {
      // This step will work once the position list component is implemented
      // For now, we just verify the dropdown closed successfully

      // Future: Check that the imported position appears at the top of the list
      // const positionListItem = page.locator('text=NFT 4973304');
      // await expect(positionListItem).toBeVisible();
    });
  });

  test('should show error message for invalid NFT ID', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForPageReady(page);

    await test.step('Open dropdown and NFT form', async () => {
      await page.locator('button:has-text("Add Position")').click();
      await page.waitForTimeout(200);
      await page.locator('button:has-text("Import NFT by ID")').click();
      await page.waitForTimeout(200);
    });

    await test.step('Mock API error response', async () => {
      await page.route('**/api/v1/positions/uniswapv3/import', async (route) => {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'POSITION_NOT_FOUND',
              message: 'Position with NFT ID 999999 not found on chain 42161',
            },
          }),
        });
      });
    });

    await test.step('Enter invalid NFT ID and submit', async () => {
      const blockchainSelect = page.locator('select').first();
      await blockchainSelect.selectOption('arbitrum');

      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await nftIdInput.fill('999999');

      const importButton = page.locator('button:has-text("Import Position")');
      await importButton.click();
    });

    await test.step('Verify error message appears', async () => {
      const errorMessage = page.locator('text=Position with NFT ID 999999 not found');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });

      // Take screenshot of error state
      await page.screenshot({
        path: 'test-results/import-nft-error.png',
        fullPage: true,
      });
    });

    await test.step('Verify dropdown stays open on error', async () => {
      // Form should still be visible after error
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await expect(nftIdInput).toBeVisible();

      // Import button should be enabled again
      const importButton = page.locator('button:has-text("Import Position")');
      await expect(importButton).toBeEnabled();
    });
  });

  test('should disable import button when NFT ID is empty', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForPageReady(page);

    await test.step('Open dropdown and NFT form', async () => {
      await page.locator('button:has-text("Add Position")').click();
      await page.waitForTimeout(200);
      await page.locator('button:has-text("Import NFT by ID")').click();
      await page.waitForTimeout(200);
    });

    await test.step('Verify import button is disabled with empty input', async () => {
      const importButton = page.locator('button:has-text("Import Position")');
      await expect(importButton).toBeDisabled();

      // Take screenshot
      await page.screenshot({
        path: 'test-results/import-nft-disabled-empty.png',
        fullPage: true,
      });
    });

    await test.step('Enter NFT ID and verify button becomes enabled', async () => {
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await nftIdInput.fill('4973304');

      const importButton = page.locator('button:has-text("Import Position")');
      await expect(importButton).toBeEnabled();
    });

    await test.step('Clear input and verify button becomes disabled again', async () => {
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await nftIdInput.clear();

      const importButton = page.locator('button:has-text("Import Position")');
      await expect(importButton).toBeDisabled();
    });
  });

  test('should not close dropdown on outside click', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForPageReady(page);

    await test.step('Open dropdown', async () => {
      await page.locator('button:has-text("Add Position")').click();
      await page.waitForTimeout(200);
    });

    await test.step('Click outside dropdown', async () => {
      // Click on the page background (not the dropdown)
      await page.locator('h2:has-text("Your Positions")').click();
      await page.waitForTimeout(200);
    });

    await test.step('Verify dropdown stays open', async () => {
      const importNftOption = page.locator('text=Import NFT by ID');
      await expect(importNftOption).toBeVisible();
    });

    await test.step('Open NFT form and enter data', async () => {
      await page.locator('button:has-text("Import NFT by ID")').click();
      await page.waitForTimeout(200);

      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await nftIdInput.fill('4973304');
    });

    await test.step('Click outside again', async () => {
      await page.locator('h2:has-text("Your Positions")').click();
      await page.waitForTimeout(200);
    });

    await test.step('Verify form data is preserved', async () => {
      // Form should still be visible
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await expect(nftIdInput).toBeVisible();

      // Input value should be preserved
      const inputValue = await nftIdInput.inputValue();
      expect(inputValue).toBe('4973304');
    });
  });

  test('should close dropdown when Add Position button is clicked again', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForPageReady(page);

    await test.step('Open dropdown', async () => {
      const addPositionButton = page.locator('button:has-text("Add Position")');
      await addPositionButton.click();
      await page.waitForTimeout(200);

      // Verify dropdown is open
      const importNftOption = page.locator('text=Import NFT by ID');
      await expect(importNftOption).toBeVisible();
    });

    await test.step('Click Add Position button again to close', async () => {
      const addPositionButton = page.locator('button:has-text("Add Position")');
      await addPositionButton.click();
      await page.waitForTimeout(200);
    });

    await test.step('Verify dropdown is closed', async () => {
      const importNftOption = page.locator('text=Import NFT by ID');
      await expect(importNftOption).not.toBeVisible();
    });
  });
});
