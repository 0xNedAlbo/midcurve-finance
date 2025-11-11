/**
 * Auth Test Fixtures
 *
 * Reusable test data for auth service tests.
 * Provides consistent, realistic test data for users, wallets, and API keys.
 */

import type { User, AuthWalletAddress, ApiKey } from '@midcurve/database';
import type { CreateUserInput } from '../types/auth/index.js';
import { createHash } from 'crypto';

// ===========================================================================
// User Fixtures
// ===========================================================================

/**
 * User fixture structure
 */
export interface UserFixture {
  input: CreateUserInput;
  dbResult: User;
}

/**
 * Alice - User with wallet on Ethereum
 */
export const ALICE: UserFixture = {
  input: {
    name: 'Alice',
    email: 'alice@example.com',
    image: 'https://example.com/alice.png',
    walletAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    walletChainId: 1,
  },
  dbResult: {
    id: 'user_alice_001',
    name: 'Alice',
    email: 'alice@example.com',
    image: 'https://example.com/alice.png',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
};

/**
 * Bob - User without email or image
 */
export const BOB: UserFixture = {
  input: {
    name: 'Bob',
    email: undefined,
    image: undefined,
  },
  dbResult: {
    id: 'user_bob_001',
    name: 'Bob',
    email: null,
    image: null,
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  },
};

/**
 * Charlie - User with email but no image
 */
export const CHARLIE: UserFixture = {
  input: {
    name: 'Charlie',
    email: 'charlie@example.com',
    image: undefined,
  },
  dbResult: {
    id: 'user_charlie_001',
    name: 'Charlie',
    email: 'charlie@example.com',
    image: null,
    createdAt: new Date('2024-01-03T00:00:00.000Z'),
    updatedAt: new Date('2024-01-03T00:00:00.000Z'),
  },
};

// ===========================================================================
// Wallet Address Fixtures
// ===========================================================================

/**
 * Wallet address fixture structure
 */
export interface WalletFixture {
  dbResult: AuthWalletAddress;
}

/**
 * Alice's primary wallet on Ethereum
 */
export const ALICE_ETHEREUM_WALLET: WalletFixture = {
  dbResult: {
    id: 'wallet_alice_eth_001',
    userId: 'user_alice_001',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    isPrimary: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
};

/**
 * Alice's secondary wallet on Arbitrum
 */
export const ALICE_ARBITRUM_WALLET: WalletFixture = {
  dbResult: {
    id: 'wallet_alice_arb_001',
    userId: 'user_alice_001',
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 42161,
    isPrimary: false,
    createdAt: new Date('2024-01-05T00:00:00.000Z'),
    updatedAt: new Date('2024-01-05T00:00:00.000Z'),
  },
};

/**
 * Bob's wallet on Base
 */
export const BOB_BASE_WALLET: WalletFixture = {
  dbResult: {
    id: 'wallet_bob_base_001',
    userId: 'user_bob_001',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
    isPrimary: true,
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  },
};

/**
 * Unregistered wallet (not linked to any user)
 */
export const UNREGISTERED_WALLET = {
  address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  chainId: 1,
};

// ===========================================================================
// API Key Fixtures
// ===========================================================================

/**
 * API key fixture structure
 */
export interface ApiKeyFixture {
  key: string; // Full plaintext key
  keyHash: string; // SHA-256 hash
  dbResult: ApiKey;
}

/**
 * Helper to create API key hash
 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Alice's production API key
 */
const ALICE_KEY_1 = 'mc_live_ABC123xyz789DEF456ghi012JKL345';
export const ALICE_API_KEY_1: ApiKeyFixture = {
  key: ALICE_KEY_1,
  keyHash: hashKey(ALICE_KEY_1),
  dbResult: {
    id: 'apikey_alice_001',
    userId: 'user_alice_001',
    name: 'Production API',
    keyHash: hashKey(ALICE_KEY_1),
    keyPrefix: 'mc_live_',
    lastUsed: new Date('2024-01-10T12:00:00.000Z'),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-10T12:00:00.000Z'),
  },
};

/**
 * Alice's development API key (never used)
 */
const ALICE_KEY_2 = 'mc_live_MNO678pqr012STU345vwx678YZA901';
export const ALICE_API_KEY_2: ApiKeyFixture = {
  key: ALICE_KEY_2,
  keyHash: hashKey(ALICE_KEY_2),
  dbResult: {
    id: 'apikey_alice_002',
    userId: 'user_alice_001',
    name: 'Development API',
    keyHash: hashKey(ALICE_KEY_2),
    keyPrefix: 'mc_live_',
    lastUsed: null,
    createdAt: new Date('2024-01-05T00:00:00.000Z'),
    updatedAt: new Date('2024-01-05T00:00:00.000Z'),
  },
};

/**
 * Bob's API key
 */
const BOB_KEY = 'mc_live_BCD234efg567HIJ890klm123NOP456';
export const BOB_API_KEY: ApiKeyFixture = {
  key: BOB_KEY,
  keyHash: hashKey(BOB_KEY),
  dbResult: {
    id: 'apikey_bob_001',
    userId: 'user_bob_001',
    name: 'Bob API Key',
    keyHash: hashKey(BOB_KEY),
    keyPrefix: 'mc_live_',
    lastUsed: new Date('2024-01-08T08:00:00.000Z'),
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    updatedAt: new Date('2024-01-08T08:00:00.000Z'),
  },
};

/**
 * Invalid API key (wrong format)
 */
export const INVALID_API_KEY = 'invalid_key_format';

/**
 * Non-existent API key (valid format but not in DB)
 */
export const NON_EXISTENT_API_KEY = 'mc_live_QRS345tuv678WXY901zab234CDE567';

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * Create custom user fixture
 */
export function createUserFixture(
  overrides: Partial<CreateUserInput> & { id?: string } = {}
): UserFixture {
  const id = overrides.id ?? 'user_test_001';
  const name = overrides.name ?? 'Test User';
  const email = overrides.email ?? undefined;
  const image = overrides.image ?? undefined;

  return {
    input: {
      name,
      email,
      image,
      walletAddress: overrides.walletAddress,
      walletChainId: overrides.walletChainId,
    },
    dbResult: {
      id,
      name,
      email: email ?? null,
      image: image ?? null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    },
  };
}

/**
 * Create custom wallet fixture
 */
export function createWalletFixture(
  overrides: Partial<AuthWalletAddress> = {}
): WalletFixture {
  return {
    dbResult: {
      id: overrides.id ?? 'wallet_test_001',
      userId: overrides.userId ?? 'user_test_001',
      address: overrides.address ?? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: overrides.chainId ?? 1,
      isPrimary: overrides.isPrimary ?? false,
      createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: overrides.updatedAt ?? new Date('2024-01-01T00:00:00.000Z'),
    },
  };
}

/**
 * Create custom API key fixture
 */
export function createApiKeyFixture(
  overrides: Partial<ApiKey> & { key?: string } = {}
): ApiKeyFixture {
  const key = overrides.key ?? 'mc_live_TEST123xyz456ABC789def012GHI345';
  const keyHash = hashKey(key);

  return {
    key,
    keyHash,
    dbResult: {
      id: overrides.id ?? 'apikey_test_001',
      userId: overrides.userId ?? 'user_test_001',
      name: overrides.name ?? 'Test API Key',
      keyHash,
      keyPrefix: overrides.keyPrefix ?? 'mc_live_',
      lastUsed: overrides.lastUsed ?? null,
      createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: overrides.updatedAt ?? new Date('2024-01-01T00:00:00.000Z'),
    },
  };
}
