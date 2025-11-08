/**
 * NFT Import Integration Tests (Real API)
 *
 * These tests use REAL authentication and call the REAL backend API.
 * Unlike the mocked UI tests, these verify end-to-end integration.
 *
 * Prerequisites:
 * - Backend API must be running at NEXT_PUBLIC_API_URL (default: http://localhost:3001)
 * - Database must be accessible
 * - RPC endpoints must be configured
 *
 * The tests use a deterministic test wallet (Hardhat/Foundry default) for reproducible results.
 */

import { test, expect } from '@playwright/test';
import { setupAuthForIntegrationTests, TEST_WALLET_ADDRESS } from '../fixtures/simple-auth';
import { waitForPageReady } from '../fixtures/test-helpers';

// Mark tests as requiring the backend API
test.describe('Import NFT Integration (Real API)', () => {
  test.beforeEach(async ({ page }) => {
    // Setup mocked auth session (allows real API calls)
    await setupAuthForIntegrationTests(page);
  });

  test('should import Arbitrum NFT 4973304 via real API', async ({ page }) => {
    await test.step('Navigate to dashboard', async () => {
      await page.goto('/dashboard');
      await waitForPageReady(page);
    });

    await test.step('Verify authenticated user is displayed', async () => {
      // The UserDropdown should show our test wallet address
      const addressDisplay = page.locator(`text=${TEST_WALLET_ADDRESS.slice(0, 6)}`);
      await expect(addressDisplay).toBeVisible({ timeout: 5000 });

      await page.screenshot({
        path: 'test-results/integration-dashboard-authenticated.png',
        fullPage: true,
      });
    });

    await test.step('Open Add Position dropdown', async () => {
      const addPositionButton = page.locator('button:has-text("Add Position")');
      await addPositionButton.click();
      await page.waitForTimeout(200);
    });

    await test.step('Expand Import NFT form', async () => {
      const importNftOption = page.locator('button:has-text("Import NFT by ID")');
      await importNftOption.click();
      await page.waitForTimeout(200);
    });

    await test.step('Fill in Arbitrum and NFT ID 4973304', async () => {
      // Select Arbitrum
      const blockchainSelect = page.locator('select').first();
      await blockchainSelect.selectOption('arbitrum');

      // Enter NFT ID
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await nftIdInput.fill('4973304');

      await page.screenshot({
        path: 'test-results/integration-form-filled.png',
        fullPage: true,
      });
    });

    await test.step('Submit import request to REAL API', async () => {
      const importButton = page.locator('button:has-text("Import Position")');
      await importButton.click();

      console.log('[E2E] Submitting import request to real API...');
    });

    await test.step('Verify loading state', async () => {
      const loadingButton = page.locator('button:has-text("Importing...")');
      await expect(loadingButton).toBeVisible();
      await expect(loadingButton).toBeDisabled();

      await page.screenshot({
        path: 'test-results/integration-loading.png',
        fullPage: true,
      });
    });

    await test.step('Wait for API response and verify success', async () => {
      // Wait for either success or error message
      const successMessage = page.locator('text=Import Successful!');
      const errorMessage = page.locator('[class*="red"]');

      // Wait up to 30 seconds for API response (RPC calls can be slow)
      await Promise.race([
        successMessage.waitFor({ state: 'visible', timeout: 30000 }),
        errorMessage.waitFor({ state: 'visible', timeout: 30000 }),
      ]);

      // Check if we got success
      const isSuccess = await successMessage.isVisible();

      if (isSuccess) {
        console.log('[E2E] ✅ Position imported successfully!');

        await page.screenshot({
          path: 'test-results/integration-success.png',
          fullPage: true,
        });

        // Verify NFT ID is mentioned
        const nftIdInMessage = page.locator('text=4973304');
        await expect(nftIdInMessage).toBeVisible();
      } else {
        // Take screenshot of error
        await page.screenshot({
          path: 'test-results/integration-error.png',
          fullPage: true,
        });

        // Get error text for debugging
        const errorText = await errorMessage.textContent();
        console.log('[E2E] ❌ Import failed:', errorText);

        // Still pass the test if it's an expected error (e.g., position already exists)
        if (errorText?.includes('already exists') || errorText?.includes('duplicate')) {
          console.log('[E2E] ℹ️  Position already exists - this is acceptable');
        } else {
          throw new Error(`API import failed: ${errorText}`);
        }
      }
    });

    await test.step('Verify dropdown auto-closes', async () => {
      // Wait for auto-close (2 second delay)
      await page.waitForTimeout(2500);

      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await expect(nftIdInput).not.toBeVisible();

      await page.screenshot({
        path: 'test-results/integration-closed.png',
        fullPage: true,
      });
    });

    // Future: Verify position appears in list
    // This will work once position list component is implemented
  });

  test('should handle API errors gracefully', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForPageReady(page);

    await test.step('Open import form', async () => {
      await page.locator('button:has-text("Add Position")').click();
      await page.waitForTimeout(200);
      await page.locator('button:has-text("Import NFT by ID")').click();
      await page.waitForTimeout(200);
    });

    await test.step('Submit invalid NFT ID', async () => {
      const blockchainSelect = page.locator('select').first();
      await blockchainSelect.selectOption('arbitrum');

      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await nftIdInput.fill('999999999'); // Unlikely to exist

      const importButton = page.locator('button:has-text("Import Position")');
      await importButton.click();
    });

    await test.step('Wait for error response from API', async () => {
      // Wait for error message (real API will return 404 or similar)
      const errorContainer = page.locator('[class*="red"]');
      await expect(errorContainer).toBeVisible({ timeout: 30000 });

      const errorText = await errorContainer.textContent();
      console.log('[E2E] Received expected error:', errorText);

      await page.screenshot({
        path: 'test-results/integration-api-error.png',
        fullPage: true,
      });

      // Verify error message is meaningful
      expect(errorText).toBeTruthy();
      expect(errorText?.length).toBeGreaterThan(0);
    });

    await test.step('Verify form stays open on error', async () => {
      const nftIdInput = page.locator('input[placeholder*="123456"]');
      await expect(nftIdInput).toBeVisible();

      const importButton = page.locator('button:has-text("Import Position")');
      await expect(importButton).toBeEnabled();
    });
  });

  test('should maintain authentication across page reloads', async ({ page }) => {
    await test.step('Navigate to dashboard', async () => {
      await page.goto('/dashboard');
      await waitForPageReady(page);
    });

    await test.step('Verify authenticated', async () => {
      const addressDisplay = page.locator(`text=${TEST_WALLET_ADDRESS.slice(0, 6)}`);
      await expect(addressDisplay).toBeVisible();
    });

    await test.step('Reload page', async () => {
      await page.reload();
      await waitForPageReady(page);
    });

    await test.step('Verify still authenticated after reload', async () => {
      const addressDisplay = page.locator(`text=${TEST_WALLET_ADDRESS.slice(0, 6)}`);
      await expect(addressDisplay).toBeVisible({ timeout: 5000 });

      // Should not redirect to signin
      await expect(page).toHaveURL(/\/dashboard/);
    });
  });
});

// Optional: Add a test.describe.configure to mark these as requiring backend
test.describe.configure({
  // Run integration tests serially to avoid rate limits
  mode: 'serial',
  // Give more time for API calls
  timeout: 60000,
});
