/**
 * useHyperliquidWallet Hook
 *
 * Fetches and manages the user's Hyperliquid API wallet.
 * Unlike EVM automation wallets (generated), Hyperliquid wallets are imported
 * from user-provided private keys created on hyperliquid.xyz.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hyperliquidApi } from '@/lib/api-client';
import type {
  GetHyperliquidWalletResponseData,
  ImportHyperliquidWalletRequest,
  ImportHyperliquidWalletResponseData,
  DeleteHyperliquidWalletResponseData,
} from '@midcurve/api-shared';

/**
 * Query key for Hyperliquid wallet data
 */
export const hyperliquidWalletQueryKey = ['hyperliquid', 'wallet'] as const;

/**
 * Hook to fetch the user's Hyperliquid wallet info
 *
 * Returns wallet address, label, and timestamps.
 * Returns null if no wallet has been imported yet.
 */
export function useHyperliquidWallet() {
  return useQuery({
    queryKey: hyperliquidWalletQueryKey,
    queryFn: async (): Promise<GetHyperliquidWalletResponseData | null> => {
      const response = await hyperliquidApi.getWallet();
      return response.data;
    },
    staleTime: 30_000, // Consider fresh for 30 seconds
    refetchInterval: 60_000, // Refetch every minute
  });
}

/**
 * Hook to import a Hyperliquid wallet from a user-provided private key
 *
 * The private key is created by the user on hyperliquid.xyz.
 * Each user can only have one Hyperliquid wallet.
 */
export function useImportHyperliquidWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ImportHyperliquidWalletRequest): Promise<ImportHyperliquidWalletResponseData> => {
      const response = await hyperliquidApi.importWallet(input);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate wallet data to refresh and show the new wallet
      queryClient.invalidateQueries({ queryKey: hyperliquidWalletQueryKey });
    },
  });
}

/**
 * Hook to delete the user's Hyperliquid wallet
 *
 * This is a soft delete - the wallet is marked as inactive.
 */
export function useDeleteHyperliquidWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<DeleteHyperliquidWalletResponseData> => {
      const response = await hyperliquidApi.deleteWallet();
      return response.data;
    },
    onSuccess: () => {
      // Invalidate wallet data to refresh and show empty state
      queryClient.invalidateQueries({ queryKey: hyperliquidWalletQueryKey });
    },
  });
}
