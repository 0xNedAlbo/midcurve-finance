/**
 * useNftApproval - Check and set single-token ERC-721 approval
 *
 * Used to approve the VaultFactory to transfer a specific NFT.
 * Unlike useOperatorApproval (which uses setApprovalForAll for operator-level),
 * this uses approve(address, tokenId) for single-token approval.
 *
 * Flow:
 * 1. Check getApproved(tokenId) via backend API
 * 2. Compare returned address to spender (factory)
 * 3. If not approved, user calls approve()
 * 4. User signs approve(spender, tokenId) tx in wallet
 * 5. Wait for confirmation, refetch approval status
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { useAccount } from 'wagmi';
import type { Address, Hash } from 'viem';
import type { Erc721ApprovalData } from '@midcurve/api-shared';
import {
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  getNonfungiblePositionManagerAddress,
} from '@/config/contracts/nonfungible-position-manager';
import { compareAddresses } from '@midcurve/shared';
import { apiClient } from '@/lib/api-client';

export interface UseNftApprovalResult {
  isApproved: boolean;
  isChecking: boolean;
  approve: () => void;
  isApproving: boolean;
  isWaitingForConfirmation: boolean;
  isApprovalSuccess: boolean;
  txHash: Hash | undefined;
  error: Error | null;
  reset: () => void;
  refetch: () => void;
}

/**
 * Hook for managing single-token ERC-721 approval on the NonfungiblePositionManager
 *
 * @param chainId - The chain ID
 * @param nftId - The NFT token ID to approve
 * @param spenderAddress - The address to approve (e.g., VaultFactory)
 */
export function useNftApproval(
  chainId: number | undefined,
  nftId: bigint | undefined,
  spenderAddress: Address | undefined
): UseNftApprovalResult {
  const [error, setError] = useState<Error | null>(null);
  const { address: ownerAddress } = useAccount();
  const queryClient = useQueryClient();

  const nfpmAddress = chainId ? getNonfungiblePositionManagerAddress(chainId) : undefined;

  // Read current approved address for this token via backend API
  const canCheck = !!nfpmAddress && !!ownerAddress && nftId !== undefined && !!chainId;
  const approvalQueryKey = ['erc721-approval', chainId, nfpmAddress, ownerAddress, nftId?.toString()];

  const {
    data: approvalData,
    isLoading: isChecking,
    error: readError,
  } = useQuery({
    queryKey: approvalQueryKey,
    queryFn: async (): Promise<Erc721ApprovalData> => {
      const response = await apiClient.get<Erc721ApprovalData>(
        `/api/v1/tokens/erc721/approval?tokenAddress=${nfpmAddress}&ownerAddress=${ownerAddress}&tokenId=${nftId!.toString()}&chainId=${chainId}`
      );
      return response.data;
    },
    enabled: canCheck,
    staleTime: 30_000,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: approvalQueryKey });
  }, [queryClient, approvalQueryKey]);

  const isApproved = !!approvalData?.approvedAddress && !!spenderAddress &&
    compareAddresses(approvalData.approvedAddress, spenderAddress) === 0;

  // Write contract hook for approval
  const {
    writeContract,
    data: txHash,
    isPending: isApproving,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for approval transaction confirmation
  const txWatch = useWatchTransactionStatus({
    txHash: txHash ?? null,
    chainId: chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!txHash,
  });
  const isWaitingForConfirmation = !!txHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isApprovalSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  // Refetch approval status after successful transaction
  useEffect(() => {
    if (isApprovalSuccess) {
      refetch();
    }
  }, [isApprovalSuccess, refetch]);

  // Handle errors
  useEffect(() => {
    if (readError) {
      setError(readError);
    } else if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [readError, writeError, receiptError]);

  const approve = useCallback(() => {
    if (!nfpmAddress || !spenderAddress || !chainId || nftId === undefined) {
      setError(new Error('Missing required parameters for NFT approval'));
      return;
    }

    setError(null);

    writeContract({
      address: nfpmAddress,
      abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
      functionName: 'approve',
      args: [spenderAddress, nftId],
      chainId,
    });
  }, [nfpmAddress, spenderAddress, chainId, nftId, writeContract]);

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
  }, [resetWrite]);

  return {
    isApproved,
    isChecking,
    approve,
    isApproving,
    isWaitingForConfirmation,
    isApprovalSuccess,
    txHash,
    error,
    reset,
    refetch,
  };
}
