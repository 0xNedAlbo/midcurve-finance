/**
 * E2E Test Helpers
 *
 * Utilities for testing API endpoints end-to-end.
 */

import { PrismaClient } from '@prisma/client';

// ============================================================================
// Test Constants
// ============================================================================

/**
 * Test API key (seeded in global setup)
 * Use this for authenticated requests
 */
export const TEST_API_KEY = 'mc_test_1234567890abcdefghijklmnopqrstuvwxyz';

/**
 * Test user ID (seeded in global setup)
 */
export const TEST_USER_ID = 'test-user-api-e2e';

/**
 * Test wallet ID (primary wallet, seeded in global setup)
 */
export const TEST_WALLET_ID = 'test-wallet-api-e2e';

/**
 * Test wallet address (primary wallet, seeded in global setup)
 */
export const TEST_WALLET_ADDRESS = '0x1234567890123456789012345678901234567890';

/**
 * Secondary test wallet ID (non-primary, seeded in global setup)
 */
export const TEST_WALLET_SECONDARY_ID = 'test-wallet-secondary-api-e2e';

/**
 * Secondary test wallet address (non-primary, seeded in global setup)
 */
export const TEST_WALLET_SECONDARY_ADDRESS = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';

/**
 * Base URL for API requests
 * Uses localhost:3000 for testing Next.js API routes
 */
export const API_BASE_URL = process.env.AUTH_URL || 'http://localhost:3000';

/**
 * Well-known token addresses for testing token endpoints
 */
export const TEST_TOKENS = {
  /**
   * USDC on Ethereum mainnet
   * - Listed on CoinGecko with full data
   * - Reliable for testing token discovery and search
   */
  USDC_ETHEREUM: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    symbol: 'USDC',
    name: 'USD Coin',
  },

  /**
   * WETH on Arbitrum
   * - High liquidity, multiple Uniswap V3 pools
   * - Reliable for testing pool discovery
   */
  WETH_ARBITRUM: {
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    chainId: 42161,
    symbol: 'WETH',
    name: 'Wrapped Ether',
  },

  /**
   * USDC (native) on Arbitrum
   * - High liquidity, pairs with WETH and WBTC
   * - Reliable for testing pool discovery
   */
  USDC_ARBITRUM: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 42161,
    symbol: 'USDC',
    name: 'USD Coin',
  },

  /**
   * WBTC on Arbitrum
   * - Medium liquidity, pairs with USDC and WETH
   * - Reliable for testing pool discovery
   */
  WBTC_ARBITRUM: {
    address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    chainId: 42161,
    symbol: 'WBTC',
    name: 'Wrapped BTC',
  },
} as const;

// ============================================================================
// Database Utilities
// ============================================================================

/**
 * Get a Prisma client instance for test database
 * Uses DATABASE_URL from .env.test
 */
export function getPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
}

/**
 * Clear all data from the test database
 * Useful for resetting state between tests
 *
 * Note: This preserves the seed data (user, wallet, API key)
 * by using upsert in the seed script
 */
export async function clearDatabase(): Promise<void> {
  const prisma = getPrismaClient();

  try {
    // Delete in reverse order of foreign key dependencies
    await prisma.apiKey.deleteMany();
    await prisma.authWalletAddress.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.authAccount.deleteMany();
    await prisma.user.deleteMany();
    await prisma.cache.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}

// ============================================================================
// HTTP Request Helpers
// ============================================================================

/**
 * Make an authenticated GET request to an API endpoint
 *
 * @param endpoint - API endpoint path (e.g., '/api/health')
 * @param apiKey - Optional API key (defaults to TEST_API_KEY)
 * @returns Response object
 */
export async function authenticatedGet(
  endpoint: string,
  apiKey: string = TEST_API_KEY
): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Make an unauthenticated GET request to an API endpoint
 *
 * @param endpoint - API endpoint path (e.g., '/api/health')
 * @returns Response object
 */
export async function unauthenticatedGet(endpoint: string): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Make an authenticated POST request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @param body - Request body (will be JSON stringified)
 * @param apiKey - Optional API key (defaults to TEST_API_KEY)
 * @returns Response object
 */
export async function authenticatedPost(
  endpoint: string,
  body: unknown,
  apiKey: string = TEST_API_KEY
): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Make an unauthenticated POST request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @param body - Request body (will be JSON stringified)
 * @returns Response object
 */
export async function unauthenticatedPost(endpoint: string, body: unknown): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Make an authenticated PUT request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @param body - Request body (will be JSON stringified)
 * @param apiKey - Optional API key (defaults to TEST_API_KEY)
 * @returns Response object
 */
export async function authenticatedPut(
  endpoint: string,
  body: unknown,
  apiKey: string = TEST_API_KEY
): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Make an unauthenticated PUT request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @param body - Request body (will be JSON stringified)
 * @returns Response object
 */
export async function unauthenticatedPut(endpoint: string, body: unknown): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Make an authenticated PATCH request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @param body - Optional request body (will be JSON stringified)
 * @param apiKey - Optional API key (defaults to TEST_API_KEY)
 * @returns Response object
 */
export async function authenticatedPatch(
  endpoint: string,
  body?: unknown,
  apiKey: string = TEST_API_KEY
): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  const options: RequestInit = {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return fetch(url, options);
}

/**
 * Make an authenticated DELETE request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @param apiKey - Optional API key (defaults to TEST_API_KEY)
 * @returns Response object
 */
export async function authenticatedDelete(
  endpoint: string,
  apiKey: string = TEST_API_KEY
): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Make an unauthenticated PATCH request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @param body - Optional request body (will be JSON stringified)
 * @returns Response object
 */
export async function unauthenticatedPatch(endpoint: string, body?: unknown): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  const options: RequestInit = {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return fetch(url, options);
}

/**
 * Make an unauthenticated DELETE request to an API endpoint
 *
 * @param endpoint - API endpoint path
 * @returns Response object
 */
export async function unauthenticatedDelete(endpoint: string): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  return fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// Response Parsing Helpers
// ============================================================================

/**
 * Parse JSON response and return typed data
 *
 * @param response - Fetch Response object
 * @returns Parsed JSON data
 */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    throw new Error('Response body is empty');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse JSON response: ${text}`);
  }
}
