/**
 * Simplified Authentication for Integration Tests
 *
 * This provides a hybrid approach:
 * - Mocks the NextAuth session (frontend auth)
 * - Allows real API calls to go through (backend operations)
 * - Uses test wallet address for consistency
 *
 * This is practical because:
 * 1. NextAuth/SIWE is complex to automate in E2E tests
 * 2. We want to test real API integration, not auth flow
 * 3. Auth flow can be tested separately with unit/integration tests
 */

import type { Page } from '@playwright/test';

export const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

/**
 * Sets up authenticated session for E2E tests
 *
 * This mocks the NextAuth session but allows all other API calls
 * to go through to the real backend.
 */
export async function setupAuthForIntegrationTests(page: Page): Promise<void> {
  // Mock the NextAuth session endpoint
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          address: TEST_WALLET_ADDRESS,
          chainId: 1,
          name: `${TEST_WALLET_ADDRESS.slice(0, 6)}...${TEST_WALLET_ADDRESS.slice(-4)}`,
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
  });

  // Set a fake session cookie (NextAuth checks for its existence)
  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: 'test-session-token',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    },
  ]);

  console.log(`[E2E] Mocked auth session for: ${TEST_WALLET_ADDRESS}`);
  console.log('[E2E] All API calls will go to real backend');
}
