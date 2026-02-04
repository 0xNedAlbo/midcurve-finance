/**
 * useWatchTransactionStatus Hook
 *
 * React hook for watching EVM transaction status via database-backed subscriptions.
 * Creates a subscription that receives updates via RPC polling on the backend.
 *
 * Features:
 * - Creates subscription on mount with configurable target confirmations
 * - Polls for status updates at configurable intervals
 * - Tracks pending → success/reverted status transitions
 * - Tracks confirmation count until target is reached
 * - Auto-completes when target confirmations are reached
 *
 * @example
 * ```typescript
 * const { status, confirmations, isComplete, isLoading } = useWatchTransactionStatus({
 *   txHash: '0x1234567890abcdef...',
 *   chainId: 1,
 *   targetConfirmations: 12,
 * });
 *
 * if (status === 'pending') return <Spinner>Waiting for confirmation...</Spinner>;
 * if (status === 'success' && isComplete) return <SuccessBadge />;
 * if (status === 'reverted') return <ErrorBadge>Transaction failed</ErrorBadge>;
 * ```
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EvmTxStatusWatchResponseData,
  EvmTxStatusSubscriptionPollResponseData,
} from '@midcurve/api-shared';
import type { TxStatusValue } from '@midcurve/shared';
import { apiClient } from '@/lib/api-client';

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** Default target confirmations */
const DEFAULT_TARGET_CONFIRMATIONS = 12;

/**
 * Options for useWatchTransactionStatus hook
 */
export interface UseWatchTransactionStatusOptions {
  /**
   * Transaction hash to watch (0x-prefixed, 64 hex chars)
   * Example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
   *
   * Set to null to disable watching
   */
  txHash: string | null;

  /**
   * EVM chain ID
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * Target number of confirmations before marking complete (default: 12)
   */
  targetConfirmations?: number;

  /**
   * Whether the hook is enabled (default: true)
   */
  enabled?: boolean;

  /**
   * Polling interval in milliseconds (default: 2000)
   */
  pollIntervalMs?: number;

  /**
   * Callback when transaction is confirmed (status changes from pending)
   */
  onConfirmed?: (status: TxStatusValue) => void;

  /**
   * Callback when tracking is complete (confirmations >= target)
   */
  onComplete?: (data: EvmTxStatusSubscriptionPollResponseData) => void;
}

/**
 * Return value from useWatchTransactionStatus hook
 */
export interface UseWatchTransactionStatusReturn {
  /**
   * Current transaction status
   */
  status: TxStatusValue | undefined;

  /**
   * Block number where transaction was included
   */
  blockNumber: bigint | undefined;

  /**
   * Block hash where transaction was included
   */
  blockHash: string | null | undefined;

  /**
   * Current number of confirmations
   */
  confirmations: number;

  /**
   * Whether tracking is complete (confirmations >= target)
   */
  isComplete: boolean;

  /**
   * Gas used by the transaction
   */
  gasUsed: bigint | undefined;

  /**
   * Effective gas price paid
   */
  effectiveGasPrice: bigint | undefined;

  /**
   * Number of logs emitted
   */
  logsCount: number | null | undefined;

  /**
   * Contract address if this was a deployment
   */
  contractAddress: string | null | undefined;

  /**
   * Subscription status
   */
  subscriptionStatus: 'active' | 'paused' | 'deleted' | undefined;

  /**
   * Target confirmations
   */
  targetConfirmations: number;

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
 * Hook to watch EVM transaction status via database-backed subscriptions
 *
 * Creates a subscription on mount and polls for updates. The backend uses
 * RPC polling to check transaction receipts and updates the subscription
 * state in the database.
 *
 * @param options - Configuration options
 * @returns Transaction status and controls
 */
export function useWatchTransactionStatus(
  options: UseWatchTransactionStatusOptions
): UseWatchTransactionStatusReturn {
  const {
    txHash,
    chainId,
    targetConfirmations = DEFAULT_TARGET_CONFIRMATIONS,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onConfirmed,
    onComplete,
  } = options;

  const queryClient = useQueryClient();
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const confirmedCalledRef = useRef(false);
  const completeCalledRef = useRef(false);

  // Query key for this subscription
  const subscriptionQueryKey = [
    'evm-tx-status-watch',
    chainId,
    txHash,
  ];

  // Create subscription when component mounts
  useEffect(() => {
    mountedRef.current = true;
    confirmedCalledRef.current = false;
    completeCalledRef.current = false;

    const createSubscription = async () => {
      if (!enabled || !txHash) {
        return;
      }

      setIsCreating(true);
      setCreateError(null);

      try {
        const response = await apiClient.post<EvmTxStatusWatchResponseData>(
          '/api/v1/transactions/evm/status/watch',
          {
            txHash,
            chainId,
            targetConfirmations,
          }
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
  }, [enabled, txHash, chainId, targetConfirmations]);

  // Poll for subscription updates
  const pollQuery = useQuery({
    queryKey: [...subscriptionQueryKey, subscriptionId],
    queryFn: async (): Promise<EvmTxStatusSubscriptionPollResponseData> => {
      if (!subscriptionId) {
        throw new Error('No subscription ID');
      }

      const response = await apiClient.get<EvmTxStatusSubscriptionPollResponseData>(
        `/api/v1/transactions/evm/status/watch/${subscriptionId}`
      );

      return response.data;
    },
    enabled: enabled && !!subscriptionId,
    refetchInterval: (query) => {
      // Stop polling if complete
      if (query.state.data?.isComplete) {
        return false;
      }
      return pollIntervalMs;
    },
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

  // Handle callbacks
  useEffect(() => {
    if (!pollQuery.data) return;

    const data = pollQuery.data;

    // Call onConfirmed when status changes from pending
    if (
      onConfirmed &&
      !confirmedCalledRef.current &&
      data.status !== 'pending' &&
      data.status !== 'not_found'
    ) {
      confirmedCalledRef.current = true;
      onConfirmed(data.status);
    }

    // Call onComplete when tracking is done
    if (onComplete && !completeCalledRef.current && data.isComplete) {
      completeCalledRef.current = true;
      onComplete(data);
    }
  }, [pollQuery.data, onConfirmed, onComplete]);

  // Parse numeric values
  const blockNumber = pollQuery.data?.blockNumber
    ? BigInt(pollQuery.data.blockNumber)
    : undefined;

  const gasUsed = pollQuery.data?.gasUsed
    ? BigInt(pollQuery.data.gasUsed)
    : undefined;

  const effectiveGasPrice = pollQuery.data?.effectiveGasPrice
    ? BigInt(pollQuery.data.effectiveGasPrice)
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
      await apiClient.delete(`/api/v1/transactions/evm/status/watch/${subscriptionId}`);
      setSubscriptionId(null);
      queryClient.removeQueries({
        queryKey: [...subscriptionQueryKey, subscriptionId],
      });
    } catch {
      // Ignore errors on cancel
    }
  }, [subscriptionId, queryClient, subscriptionQueryKey]);

  return {
    status: pollQuery.data?.status,
    blockNumber,
    blockHash: pollQuery.data?.blockHash,
    confirmations: pollQuery.data?.confirmations ?? 0,
    isComplete: pollQuery.data?.isComplete ?? false,
    gasUsed,
    effectiveGasPrice,
    logsCount: pollQuery.data?.logsCount,
    contractAddress: pollQuery.data?.contractAddress,
    subscriptionStatus: pollQuery.data?.subscriptionStatus,
    targetConfirmations: pollQuery.data?.targetConfirmations ?? targetConfirmations,
    isCreating,
    isPolling: pollQuery.isFetching,
    isLoading: isCreating || (!!subscriptionId && pollQuery.isLoading),
    error: createError || pollQuery.error?.message || null,
    refresh,
    cancel,
  };
}
