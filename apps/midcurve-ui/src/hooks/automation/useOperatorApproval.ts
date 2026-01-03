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
 * 1. Read isApprovedForAll(owner, operator) from NFPM
 * 2. If not approved, user calls approve()
 * 3. User signs setApprovalForAll(operator, true) tx in wallet
 * 4. Wait for confirmation
 * 5. Update approval status
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi';
import type { Address, Hash } from 'viem';
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
  const [error, setError] = useState<Error | null>(null);

  // Get NFPM address for this chain
  const nfpmAddress = chainId ? getNonfungiblePositionManagerAddress(chainId) : undefined;

  // Read current approval status
  const {
    data: isApprovedData,
    isLoading: isChecking,
    error: readError,
    refetch,
  } = useReadContract({
    address: nfpmAddress,
    abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
    functionName: 'isApprovedForAll',
    args: ownerAddress && operatorAddress ? [ownerAddress, operatorAddress] : undefined,
    query: {
      enabled: !!nfpmAddress && !!ownerAddress && !!operatorAddress,
    },
  });

  const isApproved = !!isApprovedData;

  // Write contract hook for approval
  const {
    writeContract,
    data: txHash,
    isPending: isApproving,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for approval transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess: isApprovalSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

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
