/**
 * Authentication Test Fixtures
 *
 * Provides reusable authentication state for tests that require
 * a signed-in user (SIWE wallet connection).
 */

import type { Page } from '@playwright/test';

/**
 * Mock wallet address for testing
 */
export const TEST_WALLET_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';

/**
 * Mock authenticated session data
 */
export const TEST_SESSION = {
  user: {
    address: TEST_WALLET_ADDRESS,
    chainId: 1,
  },
  expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
};

/**
 * Sets up an authenticated session for testing
 *
 * This function mocks the authentication state without requiring
 * actual wallet connection or signature verification.
 *
 * @param page - Playwright page object
 */
export async function setupAuthenticatedSession(page: Page) {
  // Mock the session API endpoint
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEST_SESSION),
    });
  });

  // Set session cookie (if using cookie-based auth)
  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: 'mock-session-token',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    },
  ]);
}

/**
 * Verifies that the user appears to be authenticated in the UI
 *
 * @param page - Playwright page object
 */
export async function verifyAuthenticationState(page: Page) {
  // Check for common authenticated UI elements
  // Adjust selectors based on your actual UI implementation
  const walletButton = page.locator('[data-testid="wallet-button"]');
  const walletAddress = page.locator('[data-testid="wallet-address"]');

  // Wait for wallet display to be visible
  await walletAddress.waitFor({ state: 'visible', timeout: 5000 });

  return {
    walletButton,
    walletAddress,
  };
}
