/**
 * useAutowallet Hook
 *
 * Fetches and manages the user's automation wallet (operator address).
 * This wallet is used to execute close orders when price triggers are met.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '@/lib/api-client';
import type {
  GetAutowalletResponseData,
  CreateAutowalletResponseData,
  RefundAutowalletRequest,
  RefundAutowalletResponseData,
} from '@midcurve/api-shared';

/**
 * Query key for autowallet data
 */
export const autowalletQueryKey = ['automation', 'wallet'] as const;

/**
 * Hook to fetch the user's automation wallet info
 *
 * Returns wallet address, balances per chain, and recent activity.
 * The data is fetched when the user is authenticated.
 */
export function useAutowallet() {
  return useQuery({
    queryKey: autowalletQueryKey,
    queryFn: async (): Promise<GetAutowalletResponseData> => {
      const response = await automationApi.getWallet();
      return response.data;
    },
    staleTime: 30_000, // Consider fresh for 30 seconds
    refetchInterval: 60_000, // Refetch every minute
  });
}

/**
 * Hook to create the user's automation wallet
 *
 * Creates a new automation wallet for the authenticated user.
 * Each user can only have one automation wallet.
 */
export function useCreateAutowallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<CreateAutowalletResponseData> => {
      const response = await automationApi.createWallet();
      return response.data;
    },
    onSuccess: () => {
      // Invalidate wallet data to refresh and show the new wallet
      queryClient.invalidateQueries({ queryKey: autowalletQueryKey });
    },
  });
}

/**
 * Hook to request a refund from the autowallet
 *
 * Initiates a refund of gas from the autowallet back to the user's wallet.
 * The refund is processed asynchronously by the signer service.
 */
export function useRefundAutowallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: RefundAutowalletRequest
    ): Promise<RefundAutowalletResponseData> => {
      const response = await automationApi.requestRefund(input);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate wallet data to refresh balances
      queryClient.invalidateQueries({ queryKey: autowalletQueryKey });
    },
  });
}

/**
 * Hook to poll refund status
 *
 * @param requestId - The refund request ID to poll
 * @param enabled - Whether to enable polling
 */
export function useRefundStatus(requestId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['automation', 'wallet', 'refund', requestId],
    queryFn: async () => {
      if (!requestId) throw new Error('No request ID');
      const response = await automationApi.getRefundStatus(requestId);
      return response.data;
    },
    enabled: enabled && !!requestId,
    refetchInterval: (query) => {
      // Stop polling when operation is complete or failed
      const status = query.state.data?.operationStatus;
      if (status === 'completed' || status === 'failed') {
        return false;
      }
      return 2000; // Poll every 2 seconds while in progress
    },
  });
}
