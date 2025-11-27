/**
 * useHyperliquidWallets - React Query hooks for Hyperliquid API wallet management
 *
 * Provides:
 * - useHyperliquidWallets() - Fetch list of wallets
 * - useRegisterHyperliquidWallet() - Register new wallet
 * - useDeleteHyperliquidWallet() - Delete existing wallet
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
  HyperliquidWalletDisplay,
  RegisterHyperliquidWalletRequest,
  RegisterHyperliquidWalletData,
} from '@midcurve/api-shared';

const API_BASE = '/api/v1/user/hyperliquid-wallets';

/**
 * Fetch list of user's Hyperliquid API wallets
 */
export function useHyperliquidWallets(
  options?: Omit<
    UseQueryOptions<HyperliquidWalletDisplay[], ApiError>,
    'queryKey' | 'queryFn'
  >
) {
  return useQuery({
    queryKey: queryKeys.user.hyperliquidWallets(),
    queryFn: async (): Promise<HyperliquidWalletDisplay[]> => {
      const response = await fetch(API_BASE, {
        method: 'GET',
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error?.message || 'Failed to fetch wallets',
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
 * Register a new Hyperliquid API wallet
 */
export function useRegisterHyperliquidWallet(
  options?: Omit<
    UseMutationOptions<
      RegisterHyperliquidWalletData,
      ApiError,
      RegisterHyperliquidWalletRequest
    >,
    'mutationKey' | 'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['hyperliquid-wallets', 'register'] as const,

    mutationFn: async (
      input: RegisterHyperliquidWalletRequest
    ): Promise<RegisterHyperliquidWalletData> => {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error?.message || 'Failed to register wallet',
          response.status,
          data.error?.code || 'REGISTER_FAILED',
          data.error?.details
        );
      }

      return data.data;
    },

    onSuccess: async (...args) => {
      // Invalidate and wait for refetch to complete
      await queryClient.invalidateQueries({
        queryKey: queryKeys.user.hyperliquidWallets(),
      });
      // Call user's onSuccess callback after cache is updated
      await options?.onSuccess?.(...args);
    },

    onError: options?.onError,
    onSettled: options?.onSettled,
  });
}

interface DeleteWalletParams {
  walletId: string;
}

/**
 * Delete a Hyperliquid API wallet
 */
export function useDeleteHyperliquidWallet(
  options?: Omit<
    UseMutationOptions<void, ApiError, DeleteWalletParams>,
    'mutationKey' | 'mutationFn'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['hyperliquid-wallets', 'delete'] as const,

    mutationFn: async ({ walletId }: DeleteWalletParams): Promise<void> => {
      const response = await fetch(`${API_BASE}/${walletId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new ApiError(
          data.error?.message || 'Failed to delete wallet',
          response.status,
          data.error?.code || 'DELETE_FAILED',
          data.error?.details
        );
      }
    },

    onSuccess: async (...args) => {
      // Invalidate and wait for refetch to complete
      await queryClient.invalidateQueries({
        queryKey: queryKeys.user.hyperliquidWallets(),
      });
      // Call user's onSuccess callback after cache is updated
      await options?.onSuccess?.(...args);
    },

    onError: options?.onError,
    onSettled: options?.onSettled,
  });
}
