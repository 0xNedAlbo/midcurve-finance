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

import type { ListPositionsParams, ListStrategiesParams, ListCloseOrdersRequest } from '@midcurve/api-shared';

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

  // ============================================
  // SWAP (ParaSwap integration)
  // ============================================
  swap: {
    all: ['swap'] as const,

    // Token list by chain
    tokens: {
      all: ['swap', 'tokens'] as const,
      byChain: (chainId: number) =>
        [...queryKeys.swap.tokens.all, chainId] as const,
    },

    // Quotes
    quotes: {
      all: ['swap', 'quotes'] as const,
      quote: (params: {
        chainId: number;
        srcToken: string;
        destToken: string;
        amount: string;
        userAddress: string;
      }) => [...queryKeys.swap.quotes.all, params] as const,
    },
  },

  // ============================================
  // STRATEGIES
  // ============================================
  strategies: {
    all: ['strategies'] as const,

    // Strategy list (deployed strategies for current user)
    lists: () => [...queryKeys.strategies.all, 'list'] as const,
    list: (params?: ListStrategiesParams) =>
      [...queryKeys.strategies.lists(), params ?? {}] as const,

    // Single strategy detail (by ID)
    details: () => [...queryKeys.strategies.all, 'detail'] as const,
    detail: (strategyId: string) =>
      [...queryKeys.strategies.details(), strategyId] as const,

    // Single strategy by contract address
    byAddresses: () => [...queryKeys.strategies.all, 'byAddress'] as const,
    byAddress: (contractAddress: string) =>
      [...queryKeys.strategies.byAddresses(), contractAddress] as const,

    // Strategy logs
    logs: (strategyId: string) =>
      [...queryKeys.strategies.all, 'logs', strategyId] as const,
    logsWithParams: (strategyId: string, params?: { level?: number; cursor?: string }) =>
      [...queryKeys.strategies.logs(strategyId), params ?? {}] as const,

    // Strategy manifests (templates for deployment)
    manifests: {
      all: ['strategies', 'manifests'] as const,
      lists: () => [...queryKeys.strategies.manifests.all, 'list'] as const,
      list: (params?: { isActive?: boolean; tags?: string[] }) =>
        [...queryKeys.strategies.manifests.lists(), params ?? {}] as const,
    },

    // Mutation keys
    mutations: {
      deploy: ['strategies', 'deploy'] as const,
    },

    // Vault operations
    vault: {
      prepare: (strategyId: string) =>
        [...queryKeys.strategies.all, 'vault', 'prepare', strategyId] as const,
    },
  },

  // ============================================
  // AUTOMATION (Close Orders + Contracts)
  // ============================================
  automation: {
    // Root
    all: ['automation'] as const,

    // ---------------------------------------------------------------------------
    // Close Orders
    // ---------------------------------------------------------------------------
    closeOrders: {
      all: ['automation', 'close-orders'] as const,

      // List operations
      lists: () => [...queryKeys.automation.closeOrders.all, 'list'] as const,
      list: (params?: ListCloseOrdersRequest) =>
        [...queryKeys.automation.closeOrders.lists(), params ?? {}] as const,

      // By position (common filter)
      byPosition: (positionId: string) =>
        [...queryKeys.automation.closeOrders.all, 'position', positionId] as const,

      // Single order detail
      details: () => [...queryKeys.automation.closeOrders.all, 'detail'] as const,
      detail: (orderId: string) =>
        [...queryKeys.automation.closeOrders.details(), orderId] as const,

      // Order status (for polling)
      statuses: () => [...queryKeys.automation.closeOrders.all, 'status'] as const,
      status: (orderId: string) =>
        [...queryKeys.automation.closeOrders.statuses(), orderId] as const,
    },

    // ---------------------------------------------------------------------------
    // Shared Contracts
    // ---------------------------------------------------------------------------
    sharedContracts: {
      all: ['automation', 'shared-contracts'] as const,

      // List all shared contracts
      lists: () => [...queryKeys.automation.sharedContracts.all, 'list'] as const,

      // By chain
      byChain: (chainId: number) =>
        [...queryKeys.automation.sharedContracts.all, 'chain', chainId] as const,
    },

    // ---------------------------------------------------------------------------
    // Automation Logs
    // ---------------------------------------------------------------------------
    logs: {
      all: ['automation', 'logs'] as const,

      // By position
      byPosition: (positionId: string) =>
        [...queryKeys.automation.logs.all, 'position', positionId] as const,
    },

    // Mutation keys
    mutations: {
      createOrder: ['automation', 'create-order'] as const,
      updateOrder: ['automation', 'update-order'] as const,
      cancelOrder: ['automation', 'cancel-order'] as const,
    },
  },
};
