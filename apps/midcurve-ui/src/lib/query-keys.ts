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

import type { ListPositionsParams, ListCloseOrdersRequest } from '@midcurve/api-shared';

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

      // Close Orders (position-scoped)
      closeOrders: {
        // All close orders for a position
        all: (chainId: number, nftId: string) =>
          [...queryKeys.positions.uniswapv3.detail(chainId, nftId), 'close-orders'] as const,

        // List with optional filters
        list: (chainId: number, nftId: string, filters?: { status?: string; type?: string }) =>
          [...queryKeys.positions.uniswapv3.closeOrders.all(chainId, nftId), 'list', filters] as const,

        // Single close order by semantic hash
        detail: (chainId: number, nftId: string, closeOrderHash: string) =>
          [...queryKeys.positions.uniswapv3.closeOrders.all(chainId, nftId), closeOrderHash] as const,
      },
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

    // Protocol-agnostic favorites (works across all protocols)
    favorites: {
      all: () => [...queryKeys.pools.all, 'favorites'] as const,
      list: (protocol?: string) =>
        [...queryKeys.pools.favorites.all(), 'list', protocol] as const,
    },

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

      // Search (token sets + chain IDs → list of pools)
      searches: () => [...queryKeys.pools.uniswapv3.all, 'search'] as const,
      search: (params: {
        tokenSetA: string[];
        tokenSetB: string[];
        chainIds: number[];
        sortBy?: string;
        limit?: number;
      }) => [...queryKeys.pools.uniswapv3.searches(), params] as const,

      // Lookup (address → multi-chain search)
      lookups: () => [...queryKeys.pools.uniswapv3.all, 'lookup'] as const,
      lookup: (address: string) =>
        [...queryKeys.pools.uniswapv3.lookups(), address.toLowerCase()] as const,
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
  // SWAP (ParaSwap + MidcurveSwapRouter)
  // ============================================
  swap: {
    all: ['swap'] as const,

    // ParaSwap quotes (used by SwapWidget)
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

    // MidcurveSwapRouter quotes (used by SwapDialog)
    routerQuotes: {
      all: ['swap', 'router-quotes'] as const,
      quote: (params: {
        chainId: number;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        maxDeviationBps: number;
      }) => [...queryKeys.swap.routerQuotes.all, params] as const,
    },

    // MidcurveSwapRouter supported chains
    routerSupportedChains: ['swap', 'router-supported-chains'] as const,
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

      // By chain (used when nftId is not available, e.g., before minting)
      byChain: (chainId: number) =>
        [...queryKeys.automation.sharedContracts.all, 'chain', chainId] as const,

      // By position (chainId + nftId)
      byPosition: (chainId: number, nftId: string) =>
        [...queryKeys.automation.sharedContracts.all, 'position', chainId, nftId] as const,
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
