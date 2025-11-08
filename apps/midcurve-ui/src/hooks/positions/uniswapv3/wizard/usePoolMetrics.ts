/**
 * usePoolMetrics Hook
 *
 * React Query hook for fetching fresh pool metrics from the subgraph.
 * Used for APR calculations in the position wizard.
 *
 * Architecture:
 * - Frontend never accesses subgraph directly
 * - All subgraph reads flow through backend API routes
 * - Pool must be discovered first (exists in database)
 * - Uses @midcurve/api-shared types for type safety
 */

import { useQuery } from '@tanstack/react-query';
import type { PoolMetricsData } from '@midcurve/api-shared';
import type { EvmChainSlug } from '@/config/chains';
import { getChainId } from '@/config/chains';

export interface UsePoolMetricsOptions {
  /**
   * Chain slug where pool exists
   * Example: 'ethereum', 'arbitrum', 'base'
   */
  chain: EvmChainSlug;

  /**
   * Pool contract address (EIP-55 checksummed or lowercase)
   * Example: "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"
   */
  poolAddress: string | null;

  /**
   * Whether the query is enabled (default: true)
   * Set to false to prevent automatic fetching
   */
  enabled?: boolean;
}

export interface UsePoolMetricsReturn {
  /**
   * Pool metrics data with token-specific volumes
   */
  metrics: PoolMetricsData | undefined;

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
   * Manually refetch metrics
   */
  refetch: () => Promise<void>;

  /**
   * Whether the pool has not been discovered yet (404 error)
   */
  isNotDiscovered: boolean;
}

/**
 * Hook to fetch fresh pool metrics for APR calculations
 *
 * @example
 * ```typescript
 * const { metrics, isLoading, error, isNotDiscovered } = usePoolMetrics({
 *   chain: 'arbitrum',
 *   poolAddress: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443',
 * });
 *
 * if (isLoading) return <Loader />;
 * if (isNotDiscovered) return <DiscoverPoolFirst />;
 * if (error) return <Error message={error} />;
 *
 * return <APRDisplay apr={calculateAPR(metrics)} />;
 * ```
 */
export function usePoolMetrics(
  options: UsePoolMetricsOptions
): UsePoolMetricsReturn {
  const { chain, poolAddress, enabled = true } = options;

  const chainId = getChainId(chain);
  const queryKey = ['pools', 'metrics', 'uniswapv3', chainId, poolAddress];

  const queryFn = async (): Promise<PoolMetricsData> => {
    if (!poolAddress) {
      throw new Error('Pool address is required');
    }

    const response = await fetch(
      `/api/v1/pools/uniswapv3/${chainId}/${poolAddress}/metrics`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage =
        errorData?.error?.message ||
        errorData?.error ||
        `HTTP ${response.status}: ${response.statusText}`;

      // Mark 404 as "not discovered" error
      if (response.status === 404) {
        const error = new Error(errorMessage) as Error & {
          isNotDiscovered: boolean;
        };
        error.isNotDiscovered = true;
        throw error;
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();

    // API returns ApiResponse<PoolMetricsData>
    // Extract the data field
    return data.data;
  };

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!poolAddress,
    staleTime: 5 * 60 * 1000, // 5 minutes (matches subgraph cache TTL)
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: (failureCount, error) => {
      // Don't retry 404 errors (pool not discovered)
      const err = error as Error & { isNotDiscovered?: boolean };
      if (err.isNotDiscovered) {
        return false;
      }

      // Don't retry validation errors (4xx)
      const errorMessage = error?.message || '';
      if (errorMessage.includes('Invalid') || errorMessage.includes('400')) {
        return false;
      }

      // Retry network errors and 503 (subgraph unavailable) up to 2 times
      return failureCount < 2;
    },
  });

  return {
    metrics: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error?.message || null,
    refetch: async () => {
      await query.refetch();
    },
    isNotDiscovered: !!(
      query.error &&
      (query.error as Error & { isNotDiscovered?: boolean }).isNotDiscovered
    ),
  };
}
