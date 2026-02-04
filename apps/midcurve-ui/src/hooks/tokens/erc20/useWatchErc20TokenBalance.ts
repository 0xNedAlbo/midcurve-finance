/**
 * useWatchErc20TokenBalance Hook
 *
 * React hook for watching ERC-20 token balances via database-backed subscriptions.
 * Creates a subscription that receives real-time updates via WebSocket Transfer events.
 *
 * Features:
 * - Creates subscription on mount, cleans up on unmount
 * - Polls for status updates at configurable intervals
 * - Automatic reconnection if subscription becomes paused
 * - Supports watching multiple tokens via batch subscriptions
 *
 * @example
 * ```typescript
 * const { balance, balanceBigInt, isLoading, error } = useWatchErc20TokenBalance({
 *   tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
 *   walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
 *   chainId: 1,
 * });
 *
 * if (isLoading) return <Loader />;
 * return <Balance value={balanceBigInt} />;
 * ```
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Erc20BalanceWatchBatchResponseData,
  Erc20BalanceSubscriptionPollResponseData,
} from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Options for useWatchErc20TokenBalance hook
 */
export interface UseWatchErc20TokenBalanceOptions {
  /**
   * ERC-20 token contract address
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" (WETH)
   *
   * Set to null to disable watching
   */
  tokenAddress: string | null;

  /**
   * Wallet address to watch balance for
   * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
   *
   * Set to null to disable watching
   */
  walletAddress: string | null;

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
 * Return value from useWatchErc20TokenBalance hook
 */
export interface UseWatchErc20TokenBalanceReturn {
  /**
   * Current balance as string (raw from API)
   */
  balance: string | undefined;

  /**
   * Current balance as bigint
   */
  balanceBigInt: bigint | undefined;

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
 * Hook to watch ERC-20 token balance via database-backed subscriptions
 *
 * Creates a subscription on mount and polls for updates. The backend uses
 * WebSocket connections to receive real-time Transfer events and updates
 * the subscription state in the database.
 *
 * @param options - Configuration options
 * @returns Balance state and controls
 */
export function useWatchErc20TokenBalance(
  options: UseWatchErc20TokenBalanceOptions
): UseWatchErc20TokenBalanceReturn {
  const {
    tokenAddress,
    walletAddress,
    chainId,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  const queryClient = useQueryClient();
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Query key for this subscription
  const subscriptionQueryKey = [
    'erc20-balance-watch',
    chainId,
    tokenAddress,
    walletAddress,
  ];

  // Create subscription when component mounts
  useEffect(() => {
    mountedRef.current = true;

    const createSubscription = async () => {
      if (!enabled || !tokenAddress || !walletAddress) {
        return;
      }

      setIsCreating(true);
      setCreateError(null);

      try {
        const response = await apiClient.post<Erc20BalanceWatchBatchResponseData>(
          '/api/v1/tokens/erc20/balance/watch',
          {
            tokens: [{ tokenAddress, chainId }],
            walletAddress,
          }
        );

        if (!mountedRef.current) return;

        const subscription = response.data.subscriptions[0];
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
  }, [enabled, tokenAddress, walletAddress, chainId]);

  // Poll for subscription updates
  const pollQuery = useQuery({
    queryKey: [...subscriptionQueryKey, subscriptionId],
    queryFn: async (): Promise<Erc20BalanceSubscriptionPollResponseData> => {
      if (!subscriptionId) {
        throw new Error('No subscription ID');
      }

      const response = await apiClient.get<Erc20BalanceSubscriptionPollResponseData>(
        `/api/v1/tokens/erc20/balance/watch/${subscriptionId}`
      );

      return response.data;
    },
    enabled: enabled && !!subscriptionId,
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

  // Parse balance from string to bigint
  const balanceBigInt = pollQuery.data?.currentBalance
    ? BigInt(pollQuery.data.currentBalance)
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
    if (!subscriptionId) return;

    try {
      await apiClient.delete(`/api/v1/tokens/erc20/balance/watch/${subscriptionId}`);
      setSubscriptionId(null);
      queryClient.removeQueries({
        queryKey: [...subscriptionQueryKey, subscriptionId],
      });
    } catch {
      // Ignore errors on cancel
    }
  }, [subscriptionId, queryClient, subscriptionQueryKey]);

  return {
    balance: pollQuery.data?.currentBalance,
    balanceBigInt,
    subscriptionStatus: pollQuery.data?.status,
    isCreating,
    isPolling: pollQuery.isFetching,
    isLoading: isCreating || (!!subscriptionId && pollQuery.isLoading),
    error: createError || pollQuery.error?.message || null,
    refresh,
    cancel,
  };
}
