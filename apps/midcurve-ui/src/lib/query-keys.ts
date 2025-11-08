/**
 * Query Key Factory - Platform-Aware Structure
 *
 * Hierarchical query key structure that separates:
 * - Platform-agnostic operations (list, search across all protocols)
 * - Platform-specific operations (detail, import, ledger per protocol)
 *
 * This structure mirrors the API endpoint organization and enables
 * fine-grained cache invalidation and updates.
 */

import type { ListPositionsParams } from '@midcurve/api-shared';

export const queryKeys = {
  // ============================================
  // POSITIONS (Platform-Agnostic + Specific)
  // ============================================
  positions: {
    // Root
    all: ['positions'] as const,

    // Platform-AGNOSTIC operations (cross-protocol)
    lists: () => [...queryKeys.positions.all, 'list'] as const,
    list: (params?: ListPositionsParams) =>
      [...queryKeys.positions.lists(), params ?? {}] as const,

    // Mutation keys
    mutations: {
      delete: ['positions', 'delete'] as const,
    },

    // Platform-SPECIFIC operations (nested by protocol)
    uniswapv3: {
      all: ['positions', 'uniswapv3'] as const,

      // Detail operations (chainId + nftId)
      details: () => [...queryKeys.positions.uniswapv3.all, 'detail'] as const,
      detail: (chainId: number, nftId: string) =>
        [...queryKeys.positions.uniswapv3.details(), chainId, nftId] as const,

      // Ledger operations
      ledgers: () => [...queryKeys.positions.uniswapv3.all, 'ledger'] as const,
      ledger: (chainId: number, nftId: string) =>
        [...queryKeys.positions.uniswapv3.ledgers(), chainId, nftId] as const,

      // APR operations
      aprs: () => [...queryKeys.positions.uniswapv3.all, 'apr'] as const,
      apr: (chainId: number, nftId: string) =>
        [...queryKeys.positions.uniswapv3.aprs(), chainId, nftId] as const,
    },

    // Future: Orca (Solana)
    orca: {
      all: ['positions', 'orca'] as const,
      details: () => [...queryKeys.positions.orca.all, 'detail'] as const,
      detail: (positionId: string) =>
        [...queryKeys.positions.orca.details(), positionId] as const,
      // ... similar structure
    },
  },

  // ============================================
  // POOLS (Platform-Specific)
  // ============================================
  pools: {
    all: ['pools'] as const,

    uniswapv3: {
      all: ['pools', 'uniswapv3'] as const,

      // Discovery (tokenA + tokenB → list of pools)
      discoveries: () => [...queryKeys.pools.uniswapv3.all, 'discover'] as const,
      discover: (chainId: number, tokenA: string, tokenB: string) =>
        [...queryKeys.pools.uniswapv3.discoveries(), chainId, tokenA, tokenB] as const,

      // Detail (single pool by address)
      details: () => [...queryKeys.pools.uniswapv3.all, 'detail'] as const,
      detail: (chainId: number, address: string) =>
        [...queryKeys.pools.uniswapv3.details(), chainId, address] as const,
    },

    // Future: Orca, Raydium, etc.
  },

  // ============================================
  // TOKENS (Platform-Specific)
  // ============================================
  tokens: {
    all: ['tokens'] as const,

    erc20: {
      all: ['tokens', 'erc20'] as const,

      // Search operations
      searches: () => [...queryKeys.tokens.erc20.all, 'search'] as const,
      search: (chainId: number, query: { symbol?: string; name?: string; address?: string }) =>
        [...queryKeys.tokens.erc20.searches(), chainId, query] as const,
    },

    // Future: Solana SPL tokens
    spl: {
      all: ['tokens', 'spl'] as const,
      // ... similar structure
    },
  },

  // ============================================
  // USER (Framework-agnostic)
  // ============================================
  user: {
    all: ['user'] as const,
    me: () => [...queryKeys.user.all, 'me'] as const,
    wallets: () => [...queryKeys.user.all, 'wallets'] as const,
    apiKeys: () => [...queryKeys.user.all, 'api-keys'] as const,
  },
};
