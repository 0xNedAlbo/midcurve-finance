/**
 * usePoolDiscovery Hook
 *
 * React Query hook for discovering Uniswap V3 pools for token pairs.
 * Fetches pool data from the backend API endpoint.
 *
 * Architecture:
 * - Frontend never accesses RPC endpoints directly
 * - All blockchain reads flow through backend API routes
 * - Uses @midcurve/api-shared types for type safety
 */

import { useQuery } from '@tanstack/react-query';
import type { PoolDiscoveryResult } from '@midcurve/shared';
import type { EvmChainSlug } from '@/config/chains';
import { getChainId } from '@/config/chains';

export interface UsePoolDiscoveryOptions {
  /**
   * Chain slug where pools exist
   * Example: 'ethereum', 'arbitrum', 'base'
   */
  chain: EvmChainSlug;

  /**
   * First token address (EIP-55 checksummed or lowercase)
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
   */
  tokenA: string | null;

  /**
   * Second token address (EIP-55 checksummed or lowercase)
   * Example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
   */
  tokenB: string | null;

  /**
   * Whether the query is enabled (default: true)
   * Set to false to prevent automatic fetching
   */
  enabled?: boolean;
}

export interface UsePoolDiscoveryReturn {
  /**
   * Array of discovered pools (sorted by TVL descending)
   * Only includes pools that exist (already created on-chain)
   */
  pools: PoolDiscoveryResult<'uniswapv3'>[] | undefined;

  /**
   * Whether the query is currently loading
   */
  isLoading: boolean;

  /**
   * Whether the query encountered an error
   */
  isError: boolean;

  /**
   * Error message if query failed
   */
  error: string | null;

  /**
   * Manually refetch pools
   */
  refetch: () => Promise<void>;

  /**
   * Whether no pools were found (query succeeded but returned empty array)
   */
  isEmpty: boolean;
}

/**
 * Hook to discover Uniswap V3 pools for a token pair
 *
 * @example
 * ```typescript
 * const { pools, isLoading, error, isEmpty } = usePoolDiscovery({
 *   chain: 'ethereum',
 *   tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
 *   tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
 * });
 *
 * if (isLoading) return <Loader />;
 * if (error) return <Error message={error} />;
 * if (isEmpty) return <EmptyState />;
 *
 * return <PoolList pools={pools} />;
 * ```
 */
export function usePoolDiscovery(
  options: UsePoolDiscoveryOptions
): UsePoolDiscoveryReturn {
  const { chain, tokenA, tokenB, enabled = true } = options;

  const chainId = getChainId(chain);
  const queryKey = ['pools', 'discover', 'uniswapv3', chainId, tokenA, tokenB];

  const queryFn = async (): Promise<PoolDiscoveryResult<'uniswapv3'>[]> => {
    if (!tokenA || !tokenB) {
      throw new Error('Both token addresses are required');
    }

    const params = new URLSearchParams({
      chainId: chainId.toString(),
      tokenA,
      tokenB,
    });

    const response = await fetch(
      `/api/v1/pools/uniswapv3/discover?${params.toString()}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.error || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();

    // API returns ApiResponse<PoolDiscoveryResult[]>
    // Extract the data field
    return data.data || [];
  };

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!tokenA && !!tokenB,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: (failureCount, error) => {
      // Don't retry validation errors (4xx)
      const errorMessage = error?.message || '';
      if (errorMessage.includes('Invalid') || errorMessage.includes('400')) {
        return false;
      }
      // Retry network errors up to 2 times
      return failureCount < 2;
    },
  });

  return {
    pools: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error?.message || null,
    refetch: async () => {
      await query.refetch();
    },
    isEmpty: !query.isLoading && !query.isError && query.data?.length === 0,
  };
}

/**
 * Helper function to get recommended pool based on TVL
 *
 * Returns the pool with highest TVL (most liquid pool).
 * API already sorts pools by TVL descending, so we just return the first one.
 *
 * @param pools - Array of discovered pools
 * @returns Recommended pool or null if no pools available
 *
 * @example
 * ```typescript
 * const { pools } = usePoolDiscovery({ ... });
 * const recommended = getRecommendedPool(pools);
 * ```
 */
export function getRecommendedPool(
  pools: PoolDiscoveryResult<'uniswapv3'>[] | undefined
): PoolDiscoveryResult<'uniswapv3'> | null {
  if (!pools || pools.length === 0) {
    return null;
  }

  // API returns pools sorted by TVL descending
  // First pool is the most liquid (recommended)
  return pools[0];
}
