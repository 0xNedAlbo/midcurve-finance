/**
 * useAutomationWallet - React Query hooks for Automation Wallet management
 *
 * Provides:
 * - useAutomationWallet() - Fetch user's automation wallet (or null)
 * - useCreateAutomationWallet() - Create new automation wallet
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError } from '@/lib/api-client';
import type {
  AutomationWalletDisplay,
  CreateAutomationWalletRequest,
  CreateAutomationWalletResponse,
} from '@midcurve/api-shared';

const API_BASE = '/api/v1/user/automation-wallet';

/**
 * Fetch user's automation wallet
 *
 * Returns null if no wallet exists (not an error).
 * Returns the wallet display data if one exists.
 */
export function useAutomationWallet(
  options?: Omit<
    UseQueryOptions<AutomationWalletDisplay | null, ApiError>,
    'queryKey' | 'queryFn'
  >
) {
  return useQuery({
    queryKey: queryKeys.user.automationWallet(),
    queryFn: async (): Promise<AutomationWalletDisplay | null> => {
      const response = await fetch(API_BASE, {
        method: 'GET',
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error?.message || 'Failed to fetch wallet',
          response.status,
          data.error?.code || 'FETCH_FAILED',
          data.error?.details
        );
      }

      return data.data;
    },
    ...options,
  });
}

/**
 * Create a new automation wallet
 *
 * Users can only have ONE automation wallet.
 * Returns 409 Conflict if wallet already exists.
 */
export function useCreateAutomationWallet(
  options?: Omit<
    UseMutationOptions<
      CreateAutomationWalletResponse,
      ApiError,
      CreateAutomationWalletRequest | undefined
    >,
    'mutationKey' | 'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['automation-wallet', 'create'] as const,

    mutationFn: async (
      input?: CreateAutomationWalletRequest
    ): Promise<CreateAutomationWalletResponse> => {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input ?? {}),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error?.message || 'Failed to create wallet',
          response.status,
          data.error?.code || 'CREATE_FAILED',
          data.error?.details
        );
      }

      return data.data;
    },

    onSuccess: async (...args) => {
      // Invalidate and wait for refetch to complete
      await queryClient.invalidateQueries({
        queryKey: queryKeys.user.automationWallet(),
      });
      // Call user's onSuccess callback after cache is updated
      await options?.onSuccess?.(...args);
    },

    onError: options?.onError,
    onSettled: options?.onSettled,
  });
}
