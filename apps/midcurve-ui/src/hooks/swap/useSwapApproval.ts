/**
 * Swap Approval Hook
 *
 * Manages ERC20 token approvals for the swap spender contract.
 * The spender address is dynamic and comes from the quote response.
 */

import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { maxUint256, getAddress } from 'viem';
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { ERC20_ABI } from '@/config/tokens/erc20-abi';

export interface UseSwapApprovalParams {
  tokenAddress: Address | null;
  ownerAddress: Address | null;
  spenderAddress: Address | null; // TokenTransferProxy from quote
  requiredAmount: bigint;
  chainId: number | undefined;
  enabled?: boolean;
}

export interface UseSwapApprovalResult {
  // Current allowance state
  allowance: bigint | undefined;
  isLoadingAllowance: boolean;
  isApproved: boolean;
  needsApproval: boolean;

  // Approval transaction
  approve: () => void;
  isApproving: boolean;
  isWaitingForConfirmation: boolean;
  approvalError: Error | null;
  approvalTxHash: Address | undefined;

  // Refetch allowance
  refetchAllowance: () => void;
}

/**
 * Hook to manage ERC20 token approvals for swap operations
 *
 * Unlike the position wizard approval hook, this one accepts a dynamic
 * spender address from the quote response.
 *
 * @param tokenAddress - The ERC20 token address to approve
 * @param ownerAddress - The wallet address that owns the tokens
 * @param spenderAddress - The swap contract spender address (from quote)
 * @param requiredAmount - The amount of tokens needed (in smallest unit)
 * @param chainId - The chain ID for the operation
 * @param enabled - Whether to enable the hook
 */
export function useSwapApproval({
  tokenAddress,
  ownerAddress,
  spenderAddress,
  requiredAmount,
  chainId,
  enabled = true,
}: UseSwapApprovalParams): UseSwapApprovalResult {
  const [approvalError, setApprovalError] = useState<Error | null>(null);

  // Read current allowance
  const {
    data: allowanceData,
    isLoading: isLoadingAllowance,
    refetch: refetchAllowance,
  } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args:
      ownerAddress && spenderAddress
        ? [ownerAddress, spenderAddress]
        : undefined,
    query: {
      enabled:
        enabled &&
        !!tokenAddress &&
        !!ownerAddress &&
        !!spenderAddress &&
        !!chainId,
    },
    chainId,
  });

  const allowance =
    allowanceData !== undefined
      ? BigInt(allowanceData.toString())
      : undefined;

  // Check if approval is needed
  const isApproved = allowance !== undefined && allowance >= requiredAmount;
  const needsApproval = allowance !== undefined && allowance < requiredAmount;

  // Write contract for approval
  const {
    writeContract,
    data: approvalTxHash,
    isPending: isApproving,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for approval transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess: isApprovalConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: approvalTxHash,
    chainId,
  });

  // Handle approval errors
  useEffect(() => {
    if (writeError) {
      setApprovalError(writeError);
    }
  }, [writeError]);

  useEffect(() => {
    if (receiptError) {
      setApprovalError(receiptError);
    }
  }, [receiptError]);

  // Refetch allowance after approval is confirmed
  useEffect(() => {
    if (isApprovalConfirmed) {
      refetchAllowance();
      resetWrite();
      setApprovalError(null);
    }
  }, [isApprovalConfirmed, refetchAllowance, resetWrite]);

  // Approve function - approves max amount for gas efficiency
  const approve = () => {
    if (!tokenAddress || !spenderAddress || !chainId) {
      setApprovalError(
        new Error('Missing required parameters for approval')
      );
      return;
    }

    setApprovalError(null);

    try {
      const checksummedTokenAddress = getAddress(tokenAddress);
      const checksummedSpenderAddress = getAddress(spenderAddress);

      writeContract({
        address: checksummedTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [checksummedSpenderAddress, maxUint256],
        chainId,
      });
    } catch (error) {
      setApprovalError(error as Error);
    }
  };

  return {
    // Allowance state
    allowance,
    isLoadingAllowance,
    isApproved,
    needsApproval,

    // Approval transaction
    approve,
    isApproving,
    isWaitingForConfirmation,
    approvalError,
    approvalTxHash,

    // Refetch
    refetchAllowance,
  };
}
