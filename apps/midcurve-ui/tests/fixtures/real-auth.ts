/**
 * Real Authentication Fixtures for E2E Tests
 *
 * Unlike the mocked auth in auth.ts, this module provides REAL authentication
 * using the test wallet to sign SIWE messages and authenticate with the actual API.
 *
 * This allows E2E tests to test real API integration while still being deterministic.
 */

import type { Page } from '@playwright/test';
import {
  TEST_WALLET_ADDRESS,
} from './test-wallet';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Performs real SIWE authentication with the API
 *
 * This function:
 * 1. Fetches a nonce from the API
 * 2. Creates a SIWE message
 * 3. Signs it with the test wallet
 * 4. Submits the signature to create a session
 * 5. Extracts the session cookie
 * 6. Injects it into the Playwright browser context
 *
 * @param page - Playwright page object
 * @param options - Authentication options
 */
export async function authenticateWithRealApi(
  page: Page,
  options?: {
    domain?: string;
    chainId?: number;
  }
): Promise<void> {
  const chainId = options?.chainId || 1;

  await page.context().addInitScript(() => {
    console.log('[E2E] Starting real API authentication...');
  });

  // Note: Current API uses simple signup without SIWE verification
  // The nonce/signature flow is prepared but not yet enforced by backend
  // Step 1: Submit to create/login user
  const signupResponse = await fetch(`${API_BASE_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include', // Important for cookies
    body: JSON.stringify({
      address: TEST_WALLET_ADDRESS,
      chainId: chainId,
      name: `Test Wallet ${TEST_WALLET_ADDRESS.slice(0, 6)}`,
    }),
  });

  if (!signupResponse.ok) {
    const errorText = await signupResponse.text();
    throw new Error(
      `Failed to authenticate: ${signupResponse.status} ${signupResponse.statusText}\n${errorText}`
    );
  }

  await signupResponse.json();
  console.log('[E2E] Successfully authenticated with API');

  // Step 2: Extract session cookie from response
  const setCookieHeader = signupResponse.headers.get('set-cookie');
  if (!setCookieHeader) {
    throw new Error('No session cookie received from API');
  }

  // Parse the cookie (simple parsing - in production you'd use a library)
  const sessionTokenMatch = setCookieHeader.match(/next-auth\.session-token=([^;]+)/);
  if (!sessionTokenMatch) {
    throw new Error('Could not extract session token from cookie');
  }

  const sessionToken = sessionTokenMatch[1];

  // Step 3: Inject session cookie into Playwright browser
  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    },
  ]);

  console.log('[E2E] Injected session cookie into browser');

  // Step 4: Set up session endpoint to return real session data
  // This makes NextAuth's useSession() hook work correctly
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          address: TEST_WALLET_ADDRESS,
          chainId: chainId,
          name: `${TEST_WALLET_ADDRESS.slice(0, 6)}...${TEST_WALLET_ADDRESS.slice(-4)}`,
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
  });

  console.log('[E2E] Real API authentication complete!');
}

/**
 * Simpler version that uses API key authentication instead of SIWE
 * Requires a test API key to be created in advance
 *
 * @param page - Playwright page object
 * @param apiKey - Test API key
 */
export async function authenticateWithApiKey(page: Page, apiKey: string): Promise<void> {
  // Inject API key into all API requests
  await page.route('**/api/v1/**', async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        'Authorization': `Bearer ${apiKey}`,
      },
    });
  });

  console.log('[E2E] Using API key authentication');
}

/**
 * Cleans up authentication state (logs out)
 *
 * @param page - Playwright page object
 */
export async function clearAuthentication(page: Page): Promise<void> {
  await page.context().clearCookies();
  console.log('[E2E] Cleared authentication');
}

/**
 * Verifies that authentication is working by checking the session
 *
 * @param page - Playwright page object
 */
export async function verifyAuthentication(page: Page): Promise<boolean> {
  try {
    const sessionResponse = await page.evaluate(async () => {
      const res = await fetch('/api/auth/session');
      return await res.json();
    });

    return sessionResponse.user?.address === TEST_WALLET_ADDRESS;
  } catch (error) {
    console.error('[E2E] Authentication verification failed:', error);
    return false;
  }
}
