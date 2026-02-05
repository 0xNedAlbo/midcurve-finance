/**
 * useWatchUniswapV3PoolPrice Hook
 *
 * React hook for watching Uniswap V3 pool prices via database-backed subscriptions.
 * Creates a subscription that receives real-time updates via WebSocket Swap events.
 *
 * Features:
 * - Creates subscription on mount, cleans up on unmount
 * - Polls for status updates at configurable intervals
 * - Automatic reconnection if subscription becomes paused
 * - Returns sqrtPriceX96 and tick for price calculations
 *
 * @example
 * ```typescript
 * const { sqrtPriceX96, currentTick, isLoading, error } = useWatchUniswapV3PoolPrice({
 *   poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
 *   chainId: 1,
 * });
 *
 * if (isLoading) return <Loader />;
 * return <Price sqrtPriceX96={sqrtPriceX96BigInt} tick={currentTick} />;
 * ```
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  UniswapV3PoolPriceWatchResponseData,
  UniswapV3PoolPriceSubscriptionPollResponseData,
} from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Options for useWatchUniswapV3PoolPrice hook
 */
export interface UseWatchUniswapV3PoolPriceOptions {
  /**
   * Pool contract address (EIP-55 checksummed)
   * Example: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   *
   * Set to null to disable watching
   */
  poolAddress: string | null;

  /**
   * EVM chain ID
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * Whether the hook is enabled (default: true)
   */
  enabled?: boolean;

  /**
   * Polling interval in milliseconds (default: 2000)
   */
  pollIntervalMs?: number;
}

/**
 * Return value from useWatchUniswapV3PoolPrice hook
 */
export interface UseWatchUniswapV3PoolPriceReturn {
  /**
   * Current sqrtPriceX96 as string (raw from API)
   */
  sqrtPriceX96: string | undefined;

  /**
   * Current sqrtPriceX96 as bigint
   */
  sqrtPriceX96BigInt: bigint | undefined;

  /**
   * Current tick of the pool
   */
  currentTick: number | undefined;

  /**
   * Subscription status
   */
  subscriptionStatus: 'active' | 'paused' | 'deleted' | undefined;

  /**
   * Whether the subscription is being created
   */
  isCreating: boolean;

  /**
   * Whether currently polling for updates
   */
  isPolling: boolean;

  /**
   * Whether initial data is loading
   */
  isLoading: boolean;

  /**
   * Error message if any
   */
  error: string | null;

  /**
   * Force refresh the subscription
   */
  refresh: () => Promise<void>;

  /**
   * Cancel the subscription
   */
  cancel: () => Promise<void>;
}

/**
 * Hook to watch Uniswap V3 pool price via database-backed subscriptions
 *
 * Creates a subscription on mount and polls for updates. The backend uses
 * WebSocket connections to receive real-time Swap events and updates
 * the subscription state in the database.
 *
 * @param options - Configuration options
 * @returns Pool price state and controls
 */
export function useWatchUniswapV3PoolPrice(
  options: UseWatchUniswapV3PoolPriceOptions
): UseWatchUniswapV3PoolPriceReturn {
  const {
    poolAddress,
    chainId,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  const queryClient = useQueryClient();
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const mountedRef = useRef(true);

  // Query key for this subscription (memoized to prevent unnecessary re-renders)
  const subscriptionQueryKey = useMemo(
    () => ['uniswapv3-pool-price-watch', chainId, poolAddress],
    [chainId, poolAddress]
  );

  // Create subscription when component mounts
  useEffect(() => {
    mountedRef.current = true;

    const createSubscription = async () => {
      if (!enabled || !poolAddress) {
        return;
      }

      setIsCreating(true);
      setCreateError(null);

      try {
        const response = await apiClient.post<UniswapV3PoolPriceWatchResponseData>(
          `/api/v1/pools/uniswapv3/${chainId}/${poolAddress}/pool-price/watch`
        );

        if (!mountedRef.current) return;

        const subscription = response.data.subscription;
        if (subscription) {
          setSubscriptionId(subscription.subscriptionId);
        }
      } catch (error) {
        if (!mountedRef.current) return;
        setCreateError(error instanceof Error ? error.message : 'Failed to create subscription');
      } finally {
        if (mountedRef.current) {
          setIsCreating(false);
        }
      }
    };

    createSubscription();

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, poolAddress, chainId]);

  // Poll for subscription updates
  const pollQuery = useQuery({
    queryKey: [...subscriptionQueryKey, subscriptionId],
    queryFn: async (): Promise<UniswapV3PoolPriceSubscriptionPollResponseData> => {
      if (!subscriptionId || !poolAddress) {
        throw new Error('No subscription ID');
      }

      const response = await apiClient.get<UniswapV3PoolPriceSubscriptionPollResponseData>(
        `/api/v1/pools/uniswapv3/${chainId}/${poolAddress}/pool-price/watch/${subscriptionId}`
      );

      return response.data;
    },
    enabled: enabled && !!subscriptionId && !!poolAddress && !cancelled,
    refetchInterval: pollIntervalMs,
    staleTime: pollIntervalMs / 2,
    gcTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      const errorMessage = error?.message || '';
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        // Subscription was deleted, don't retry
        return false;
      }
      return failureCount < 2;
    },
  });

  // Parse sqrtPriceX96 from string to bigint
  const sqrtPriceX96BigInt = pollQuery.data?.currentSqrtPriceX96
    ? BigInt(pollQuery.data.currentSqrtPriceX96)
    : undefined;

  // Refresh callback
  const refresh = useCallback(async () => {
    if (subscriptionId) {
      await queryClient.invalidateQueries({
        queryKey: [...subscriptionQueryKey, subscriptionId],
      });
    }
  }, [subscriptionId, queryClient, subscriptionQueryKey]);

  // Cancel callback
  const cancel = useCallback(async () => {
    if (!subscriptionId || !poolAddress) return;

    // Immediately disable polling to prevent 404 race conditions
    setCancelled(true);

    try {
      await apiClient.delete(
        `/api/v1/pools/uniswapv3/${chainId}/${poolAddress}/pool-price/watch/${subscriptionId}`
      );
      setSubscriptionId(null);
      queryClient.removeQueries({
        queryKey: [...subscriptionQueryKey, subscriptionId],
      });
    } catch {
      // Ignore errors on cancel
    }
  }, [subscriptionId, poolAddress, chainId, queryClient, subscriptionQueryKey]);

  return {
    sqrtPriceX96: pollQuery.data?.currentSqrtPriceX96,
    sqrtPriceX96BigInt,
    currentTick: pollQuery.data?.currentTick,
    subscriptionStatus: pollQuery.data?.status,
    isCreating,
    isPolling: pollQuery.isFetching,
    isLoading: isCreating || (!!subscriptionId && pollQuery.isLoading),
    error: createError || pollQuery.error?.message || null,
    refresh,
    cancel,
  };
}
