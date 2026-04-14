import { useState, useEffect, useCallback } from 'react';
import type { Address } from 'viem';
import { maxUint256, getAddress } from 'viem';
import { useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';
import { apiClient } from '@/lib/api-client';
import type { Erc20ApprovalData } from '@midcurve/api-shared';
import { ERC20_ABI } from '@/config/tokens/erc20-abi';

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
  const queryClient = useQueryClient();

  // Get the NonfungiblePositionManager address for this chain
  const spenderAddress = chainId
    ? getNonfungiblePositionManagerAddress(chainId)
    : undefined;

  // Read current allowance via backend API
  const canCheck = enabled && !!tokenAddress && !!ownerAddress && !!spenderAddress && !!chainId;
  const approvalQueryKey = ['erc20-approval', chainId, tokenAddress, ownerAddress, spenderAddress];

  const {
    data: approvalData,
    isLoading: isLoadingAllowance,
  } = useQuery({
    queryKey: approvalQueryKey,
    queryFn: async (): Promise<Erc20ApprovalData> => {
      const response = await apiClient.get<Erc20ApprovalData>(
        `/api/v1/tokens/erc20/approval?tokenAddress=${tokenAddress}&ownerAddress=${ownerAddress}&spenderAddress=${spenderAddress}&chainId=${chainId}`
      );
      return response.data;
    },
    enabled: canCheck,
    staleTime: 30_000,
  });

  const allowance =
    approvalData?.allowance !== undefined
      ? BigInt(approvalData.allowance)
      : undefined;

  // Check if approval is needed
  const isApproved = allowance !== undefined && allowance >= requiredAmount;
  const needsApproval = allowance !== undefined && allowance < requiredAmount;

  const refetchAllowance = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: approvalQueryKey });
  }, [queryClient, approvalQueryKey]);

  // Write contract for approval
  const {
    writeContract,
    data: approvalTxHash,
    isPending: isApproving,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for approval transaction confirmation via backend subscription
  const txWatch = useWatchTransactionStatus({
    txHash: approvalTxHash ?? null,
    chainId: chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!approvalTxHash,
  });
  const isWaitingForConfirmation = !!approvalTxHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isApprovalConfirmed = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

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
