/**
 * Wallet Hooks
 *
 * React Query hooks for managing user wallet perimeter.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ListUserWalletsResponseData,
  AddWalletResponseData,
  DeleteWalletResponseData,
} from '@midcurve/api-shared';
import { walletsApi } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-keys';

// =============================================================================
// Queries
// =============================================================================

/**
 * Hook to fetch the authenticated user's wallets
 */
export function useUserWallets() {
  return useQuery<ListUserWalletsResponseData>({
    queryKey: queryKeys.user.wallets(),
    queryFn: async () => {
      const response = await walletsApi.listWallets();
      return response.data;
    },
  });
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Hook to add a wallet with ownership verification.
 *
 * Orchestrates the full challenge → sign → submit flow:
 * 1. Requests a challenge message from the backend
 * 2. Signs the message using the provided signMessageAsync function
 * 3. Submits the signed message to add the wallet
 */
export function useAddWallet() {
  const queryClient = useQueryClient();

  return useMutation<
    AddWalletResponseData,
    Error,
    {
      walletType: string;
      address: string;
      signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
      label?: string;
    }
  >({
    mutationFn: async ({ walletType, address, signMessageAsync, label }) => {
      // Step 1: Get challenge from backend
      const challengeResponse = await walletsApi.getChallenge(walletType, address);
      const { message, nonce } = challengeResponse.data;

      // Step 2: Sign the challenge message with the wallet
      const signature = await signMessageAsync({ message });

      // Step 3: Submit to backend for verification and wallet creation
      const addResponse = await walletsApi.addWallet({
        walletType,
        address,
        signature,
        nonce,
        label,
      });

      return addResponse.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.wallets() });
    },
  });
}

/**
 * Hook to remove a non-primary wallet
 */
export function useDeleteWallet() {
  const queryClient = useQueryClient();

  return useMutation<DeleteWalletResponseData, Error, string>({
    mutationFn: async (walletId: string) => {
      const response = await walletsApi.deleteWallet(walletId);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.wallets() });
    },
  });
}
