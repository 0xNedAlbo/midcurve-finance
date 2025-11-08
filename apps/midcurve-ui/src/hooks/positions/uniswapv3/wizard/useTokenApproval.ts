import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { maxUint256, getAddress } from 'viem';
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { ERC20_ABI } from '@/config/tokens/erc20-abi';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';

export interface UseTokenApprovalParams {
  tokenAddress: Address | null;
  ownerAddress: Address | null;
  requiredAmount: bigint;
  chainId: number | undefined;
  enabled?: boolean;
}

export interface UseTokenApprovalResult {
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
 * Hook to manage ERC20 token approvals for Uniswap V3 NonfungiblePositionManager
 *
 * Approves MAX_UINT256 for gas efficiency (one-time approval).
 * Automatically refetches allowance after approval is confirmed.
 *
 * @param tokenAddress - The ERC20 token address to approve
 * @param ownerAddress - The wallet address that owns the tokens
 * @param requiredAmount - The amount of tokens needed (in smallest unit, e.g., wei)
 * @param chainId - The chain ID for the operation
 * @param enabled - Whether to enable the hook (default: true)
 */
export function useTokenApproval({
  tokenAddress,
  ownerAddress,
  requiredAmount,
  chainId,
  enabled = true,
}: UseTokenApprovalParams): UseTokenApprovalResult {
  const [approvalError, setApprovalError] = useState<Error | null>(null);

  // Get the NonfungiblePositionManager address for this chain
  const spenderAddress = chainId
    ? getNonfungiblePositionManagerAddress(chainId)
    : undefined;

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

  // Handle approval errors (both pre-transaction and post-transaction)
  useEffect(() => {
    if (writeError) {
      setApprovalError(writeError);
    }
  }, [writeError]);

  // Handle transaction receipt errors (transaction sent but failed onchain)
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
      // Ensure addresses are properly checksummed (EIP-55)
      const checksummedTokenAddress = getAddress(tokenAddress);
      const checksummedSpenderAddress = getAddress(spenderAddress);

      writeContract({
        address: checksummedTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [checksummedSpenderAddress, maxUint256], // Approve max amount to avoid future approvals
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
