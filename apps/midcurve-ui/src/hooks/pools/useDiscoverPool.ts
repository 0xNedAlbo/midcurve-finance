/**
 * useDiscoverPool Hook
 *
 * React Query mutation hook for discovering/persisting a pool by address.
 * Calls the backend which fetches on-chain data and persists to database.
 *
 * Usage:
 * ```tsx
 * const { mutateAsync: discoverPool, isPending } = useDiscoverPool();
 *
 * const handleSelectPool = async (pool: PoolSearchResultItem) => {
 *   try {
 *     const result = await discoverPool({
 *       chainId: pool.chainId,
 *       address: pool.poolAddress,
 *     });
 *     // result.pool is the fully populated UniswapV3Pool
 *   } catch (error) {
 *     // Handle error
 *   }
 * };
 * ```
 */

import { useMutation } from '@tanstack/react-query';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { GetUniswapV3PoolData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

export interface DiscoverPoolParams {
  /**
   * Chain ID where the pool is deployed
   */
  chainId: number;

  /**
   * Pool contract address
   */
  address: string;
}

export interface DiscoverPoolResult {
  /**
   * The discovered pool data with fresh on-chain state
   */
  pool: UniswapV3Pool;
}

/**
 * React Query mutation hook for discovering a pool
 *
 * This calls GET /api/v1/pools/uniswapv3/:chainId/:address which:
 * 1. Creates the pool in the database if it doesn't exist
 * 2. Refreshes the pool state if it already exists
 * 3. Returns the full pool data with on-chain state
 */
export function useDiscoverPool() {
  return useMutation({
    mutationFn: async ({ chainId, address }: DiscoverPoolParams): Promise<DiscoverPoolResult> => {
      const response = await apiClient.get<GetUniswapV3PoolData>(
        `/api/v1/pools/uniswapv3/${chainId}/${address}`
      );
      return {
        pool: response.data.pool,
      };
    },
  });
}
