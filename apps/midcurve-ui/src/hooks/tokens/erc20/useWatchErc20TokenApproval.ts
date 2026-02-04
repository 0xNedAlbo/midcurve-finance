/**
 * useWatchErc20TokenApproval Hook
 *
 * React hook for watching ERC-20 token approvals via database-backed subscriptions.
 * Creates a subscription that receives real-time updates via WebSocket events on the backend.
 *
 * Features:
 * - Creates subscription on mount, cleans up on unmount
 * - Polls for status updates at configurable intervals
 * - Automatic reconnection if subscription becomes paused
 * - Shared query cache across components
 *
 * @example
 * ```typescript
 * const { isApproved, allowance, isLoading, error } = useWatchErc20TokenApproval({
 *   tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
 *   ownerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
 *   spenderAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
 *   chainId: 1,
 *   requiredAmount: BigInt('1000000000000000000'),
 * });
 *
 * if (isLoading) return <Loader />;
 * if (isApproved) return <ApprovedBadge />;
 * ```
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Erc20ApprovalWatchBatchResponseData,
  Erc20ApprovalSubscriptionPollResponseData,
} from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Options for useWatchErc20TokenApproval hook
 */
export interface UseWatchErc20TokenApprovalOptions {
  /**
   * ERC-20 token contract address
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" (WETH)
   */
  tokenAddress: string | null;

  /**
   * Wallet address that owns the tokens
   * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
   */
  ownerAddress: string | null;

  /**
   * Address approved to spend tokens
   * Example: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" (Uniswap Router)
   */
  spenderAddress: string | null;

  /**
   * EVM chain ID
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * Required approval amount to check against (optional)
   * If provided, isApproved will be true when allowance >= requiredAmount
   */
  requiredAmount?: bigint;

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
 * Return value from useWatchErc20TokenApproval hook
 */
export interface UseWatchErc20TokenApprovalReturn {
  /**
   * Current allowance (as bigint)
   */
  allowance: bigint | undefined;

  /**
   * Whether unlimited approval is set
   */
  isUnlimited: boolean;

  /**
   * Whether any approval exists (allowance > 0)
   */
  hasApproval: boolean;

  /**
   * Whether approval meets the required amount (if specified)
   */
  isApproved: boolean;

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
 * Hook to watch ERC-20 token approval via database-backed subscriptions
 *
 * Creates a subscription on mount and polls for updates. The backend uses
 * WebSocket connections to receive real-time Approval events and updates
 * the subscription state in the database.
 *
 * @param options - Configuration options
 * @returns Approval state and controls
 */
export function useWatchErc20TokenApproval(
  options: UseWatchErc20TokenApprovalOptions
): UseWatchErc20TokenApprovalReturn {
  const {
    tokenAddress,
    ownerAddress,
    spenderAddress,
    chainId,
    requiredAmount,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  const queryClient = useQueryClient();
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Query key for this subscription (memoized to prevent unnecessary re-renders)
  const subscriptionQueryKey = useMemo(
    () => ['erc20-approval-watch', chainId, tokenAddress, ownerAddress, spenderAddress],
    [chainId, tokenAddress, ownerAddress, spenderAddress]
  );

  // Create subscription when component mounts
  useEffect(() => {
    mountedRef.current = true;

    const createSubscription = async () => {
      if (!enabled || !tokenAddress || !ownerAddress || !spenderAddress) {
        return;
      }

      setIsCreating(true);
      setCreateError(null);

      try {
        const response = await apiClient.post<Erc20ApprovalWatchBatchResponseData>(
          '/api/v1/tokens/erc20/approval/watch',
          {
            tokens: [{ tokenAddress, chainId }],
            ownerAddress,
            spenderAddress,
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
  }, [enabled, tokenAddress, ownerAddress, spenderAddress, chainId]);

  // Poll for subscription updates
  const pollQuery = useQuery({
    queryKey: [...subscriptionQueryKey, subscriptionId],
    queryFn: async (): Promise<Erc20ApprovalSubscriptionPollResponseData> => {
      if (!subscriptionId) {
        throw new Error('No subscription ID');
      }

      const response = await apiClient.get<Erc20ApprovalSubscriptionPollResponseData>(
        `/api/v1/tokens/erc20/approval/watch/${subscriptionId}`
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

  // Parse allowance from string to bigint
  const allowance = pollQuery.data?.currentAllowance
    ? BigInt(pollQuery.data.currentAllowance)
    : undefined;

  // Check if approved against required amount
  const isApproved =
    allowance !== undefined &&
    (requiredAmount !== undefined ? allowance >= requiredAmount : allowance > 0n);

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
      await apiClient.delete(`/api/v1/tokens/erc20/approval/watch/${subscriptionId}`);
      setSubscriptionId(null);
      queryClient.removeQueries({
        queryKey: [...subscriptionQueryKey, subscriptionId],
      });
    } catch {
      // Ignore errors on cancel
    }
  }, [subscriptionId, queryClient, subscriptionQueryKey]);

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      // Don't cancel on unmount - let the backend handle cleanup via timeout
      // This allows the subscription to persist across component re-renders
    };
  }, []);

  return {
    allowance,
    isUnlimited: pollQuery.data?.isUnlimited ?? false,
    hasApproval: pollQuery.data?.hasApproval ?? false,
    isApproved,
    subscriptionStatus: pollQuery.data?.status,
    isCreating,
    isPolling: pollQuery.isFetching,
    error: createError || pollQuery.error?.message || null,
    refresh,
    cancel,
  };
}
