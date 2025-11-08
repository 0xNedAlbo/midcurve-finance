/**
 * usePoolPrice Hook
 *
 * React Query hook for fetching current pool price data from blockchain.
 * Optimized for frequent refresh operations with aggressive caching (5 seconds).
 *
 * Usage:
 * ```tsx
 * const { sqrtPriceX96, currentTick, refetch, isLoading } = usePoolPrice({
 *   chainId: "1",
 *   poolAddress: "0x...",
 * });
 * ```
 */

import { useQuery } from '@tanstack/react-query';
import type { GetPoolPriceResponse, ApiResponse } from '@midcurve/api-shared';

/**
 * Hook props
 */
export interface UsePoolPriceProps {
  /**
   * Chain ID where the pool exists
   * @example "1" (Ethereum), "42161" (Arbitrum)
   */
  chainId?: string;

  /**
   * Pool contract address (EIP-55 checksummed)
   * @example "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"
   */
  poolAddress?: string;

  /**
   * Enable/disable the query
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook return type
 */
export interface UsePoolPriceReturn {
  /**
   * Current pool price as X96 fixed-point bigint (string)
   * Undefined if not yet loaded or error occurred
   */
  sqrtPriceX96: string | undefined;

  /**
   * Current tick of the pool
   * Undefined if not yet loaded or error occurred
   */
  currentTick: number | undefined;

  /**
   * Timestamp when the price was fetched
   * ISO 8601 format
   */
  timestamp: string | undefined;

  /**
   * Whether the query is currently loading
   */
  isLoading: boolean;

  /**
   * Whether the query resulted in an error
   */
  isError: boolean;

  /**
   * Error message if query failed
   * Null if no error
   */
  error: string | null;

  /**
   * Manually refetch the pool price
   * Returns a promise that resolves when the fetch is complete
   */
  refetch: () => Promise<void>;
}

/**
 * React Query hook for fetching current pool price
 *
 * Features:
 * - Aggressive caching (5 second staleTime)
 * - Manual refetch for refresh button
 * - Automatic error handling
 * - Type-safe API response
 *
 * @param props - Hook configuration
 * @returns Pool price data and query state
 *
 * @example
 * ```tsx
 * const { sqrtPriceX96, currentTick, refetch, isLoading } = usePoolPrice({
 *   chainId: "1",
 *   poolAddress: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
 * });
 *
 * // Manually refresh price
 * await refetch();
 * ```
 */
export function usePoolPrice({
  chainId,
  poolAddress,
  enabled = true,
}: UsePoolPriceProps): UsePoolPriceReturn {
  const query = useQuery({
    queryKey: ['poolPrice', chainId, poolAddress],
    queryFn: async () => {
      if (!chainId || !poolAddress) {
        throw new Error('chainId and poolAddress are required');
      }

      const response = await fetch(
        `/api/v1/pools/uniswapv3/${chainId}/${poolAddress}/pool-price`
      );

      if (!response.ok) {
        // Try to parse error response
        try {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to fetch pool price');
        } catch {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      const data: ApiResponse<GetPoolPriceResponse> = await response.json();

      if (!data.success || !data.data) {
        throw new Error('Invalid response from API');
      }

      return data.data;
    },
    enabled: enabled && !!chainId && !!poolAddress,
    staleTime: 5000, // 5 seconds - aggressive caching for frequent refreshes
    gcTime: 30000, // 30 seconds - keep in cache briefly
    refetchOnWindowFocus: false, // Only refresh via manual refetch
    retry: 1, // Retry once on failure
  });

  return {
    sqrtPriceX96: query.data?.sqrtPriceX96,
    currentTick: query.data?.currentTick,
    timestamp: query.data?.timestamp,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error?.message ?? null,
    refetch: async () => {
      // Force refetch by canceling stale time
      // This ensures the refresh button always fetches fresh data
      await query.refetch({ cancelRefetch: true });
    },
  };
}
