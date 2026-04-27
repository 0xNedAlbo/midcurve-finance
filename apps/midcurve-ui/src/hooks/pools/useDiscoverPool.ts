/**
 * useDiscoverPool Hook
 *
 * React Query mutation hook for discovering/persisting a pool by address.
 * Calls the backend which fetches on-chain data and persists to database.
 *
 * Optionally accepts `isToken0Quote` to round-trip the user's intended
 * base/quote orientation back via `userProvidedInfo` on the response.
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
 *       isToken0Quote: pool.userProvidedInfo?.isToken0Quote,
 *     });
 *     // result.pool is the fully populated UniswapV3Pool
 *     // result.userProvidedInfo echoes the requested orientation (when supplied)
 *   } catch (error) {
 *     // Handle error
 *   }
 * };
 * ```
 */

import { useMutation } from '@tanstack/react-query';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { GetUniswapV3PoolData, PoolUserProvidedInfo } from '@midcurve/api-shared';
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

  /**
   * Optional base/quote orientation to round-trip via `userProvidedInfo`
   * on the response. Pure echo — server does not reorient metrics/feeData.
   */
  isToken0Quote?: boolean;
}

export interface DiscoverPoolResult {
  /**
   * The discovered pool data with fresh on-chain state
   */
  pool: UniswapV3Pool;

  /**
   * Echoed base/quote orientation when `isToken0Quote` was supplied in the
   * request. Undefined when the caller did not pass an orientation.
   */
  userProvidedInfo?: PoolUserProvidedInfo;
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
    mutationFn: async ({
      chainId,
      address,
      isToken0Quote,
    }: DiscoverPoolParams): Promise<DiscoverPoolResult> => {
      const url =
        typeof isToken0Quote === 'boolean'
          ? `/api/v1/pools/uniswapv3/${chainId}/${address}?isToken0Quote=${isToken0Quote}`
          : `/api/v1/pools/uniswapv3/${chainId}/${address}`;
      const response = await apiClient.get<GetUniswapV3PoolData>(url);
      return {
        pool: response.data.pool,
        ...(response.data.userProvidedInfo && {
          userProvidedInfo: response.data.userProvidedInfo,
        }),
      };
    },
  });
}
