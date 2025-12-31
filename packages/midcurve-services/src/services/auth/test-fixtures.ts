/**
 * Auth Test Fixtures
 *
 * Reusable test data for auth service tests.
 * Provides consistent, realistic test data for users and wallets.
 */

import type { User, AuthWalletAddress } from '@midcurve/database';
import type { CreateUserInput } from '../types/auth/index.js';

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
