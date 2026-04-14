/**
 * useOperatorApproval - Check and set operator approval for automation contract
 *
 * This hook checks if the automation contract is approved as an operator
 * for the user's positions, and provides a function to approve it.
 *
 * The automation contract needs operator approval (setApprovalForAll) on the
 * NonfungiblePositionManager to be able to close positions on behalf of the user.
 *
 * Flow:
 * 1. Check isApprovedForAll via backend API
 * 2. If not approved, user calls approve()
 * 3. User signs setApprovalForAll(operator, true) tx in wallet
 * 4. Wait for confirmation via backend subscription
 * 5. Re-check approval status via backend API
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import type { Address, Hash } from 'viem';
import type { Erc721ApprovalData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import {
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  getNonfungiblePositionManagerAddress,
} from '@/config/contracts/nonfungible-position-manager';

/**
 * Hook result
 */
export interface UseOperatorApprovalResult {
  /** Whether the operator is approved */
  isApproved: boolean;
  /** Whether checking approval status */
  isChecking: boolean;
  /** Approve the operator */
  approve: () => void;
  /** Whether approval is in progress (signing) */
  isApproving: boolean;
  /** Whether waiting for approval confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether approval transaction succeeded */
  isApprovalSuccess: boolean;
  /** Approval transaction hash */
  txHash: Hash | undefined;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
  /** Refetch approval status */
  refetch: () => void;
}

/**
 * Hook for managing operator approval for automation contracts
 *
 * @param chainId - The chain ID
 * @param operatorAddress - The automation contract address (operator)
 */
export function useOperatorApproval(
  chainId: number | undefined,
  operatorAddress: Address | undefined
): UseOperatorApprovalResult {
  const { address: ownerAddress } = useAccount();
  const queryClient = useQueryClient();
  const [error, setError] = useState<Error | null>(null);

  // Get NFPM address for this chain
  const nfpmAddress = chainId ? getNonfungiblePositionManagerAddress(chainId) : undefined;

  // Check approval status via backend API
  const canCheck = !!nfpmAddress && !!ownerAddress && !!operatorAddress && !!chainId;
  const approvalQueryKey = ['erc721-approval', chainId, nfpmAddress, ownerAddress, operatorAddress];

  const {
    data: approvalData,
    isLoading: isChecking,
    error: readError,
  } = useQuery({
    queryKey: approvalQueryKey,
    queryFn: async (): Promise<Erc721ApprovalData> => {
      const response = await apiClient.get<Erc721ApprovalData>(
        `/api/v1/tokens/erc721/approval?tokenAddress=${nfpmAddress}&ownerAddress=${ownerAddress}&operatorAddress=${operatorAddress}&chainId=${chainId}`
      );
      return response.data;
    },
    enabled: canCheck,
    staleTime: 30_000,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: approvalQueryKey });
  }, [queryClient, approvalQueryKey]);

  const isApproved = approvalData?.isApprovedForAll ?? false;

  // Write contract hook for approval
  const {
    writeContract,
    data: txHash,
    isPending: isApproving,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for approval transaction confirmation via backend subscription
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

  // Approve function
  const approve = useCallback(() => {
    if (!nfpmAddress || !operatorAddress || !chainId) {
      setError(new Error('Missing required parameters for approval'));
      return;
    }

    setError(null);

    writeContract({
      address: nfpmAddress,
      abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
      functionName: 'setApprovalForAll',
      args: [operatorAddress, true],
      chainId,
    });
  }, [nfpmAddress, operatorAddress, chainId, writeContract]);

  // Reset function
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
