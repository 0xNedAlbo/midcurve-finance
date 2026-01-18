/**
 * useApproveNFT - Hook for approving NFT transfer to Hedge Vault
 *
 * Approves the Uniswap V3 position NFT for transfer to the vault address.
 * Uses the ERC721 `approve` function to grant transfer permission.
 */

import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { getAddress } from 'viem';
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';

// ERC721 approve ABI (only the functions we need)
const ERC721_APPROVE_ABI = [
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface UseApproveNFTParams {
  nftId: bigint;
  spender: Address | null;  // Vault address (computed before approval)
  chainId: number | undefined;
  enabled?: boolean;
}

export interface UseApproveNFTResult {
  // Current approval state
  approvedAddress: Address | undefined;
  isLoadingApproval: boolean;
  isApproved: boolean;
  needsApproval: boolean;

  // Approval transaction
  approve: () => void;
  isApproving: boolean;
  isWaitingForConfirmation: boolean;
  approvalError: Error | null;
  approvalTxHash: Address | undefined;

  // Refetch
  refetchApproval: () => void;
}

/**
 * Hook to manage NFT approval for Hedge Vault
 *
 * Approves the NFT for transfer to the vault address. Unlike ERC20 approval
 * which approves an amount, ERC721 approval grants transfer permission to
 * a specific address for a specific token ID.
 *
 * @param nftId - The Uniswap V3 position NFT token ID
 * @param spender - The vault address that will receive transfer permission
 * @param chainId - The chain ID for the operation
 * @param enabled - Whether to enable the hook (default: true)
 */
export function useApproveNFT({
  nftId,
  spender,
  chainId,
  enabled = true,
}: UseApproveNFTParams): UseApproveNFTResult {
  const [approvalError, setApprovalError] = useState<Error | null>(null);

  // Get the NonfungiblePositionManager address
  const nftContract = chainId
    ? getNonfungiblePositionManagerAddress(chainId)
    : undefined;

  // Read current approved address for this NFT
  const {
    data: approvedAddress,
    isLoading: isLoadingApproval,
    refetch: refetchApproval,
  } = useReadContract({
    address: nftContract,
    abi: ERC721_APPROVE_ABI,
    functionName: 'getApproved',
    args: [nftId],
    query: {
      enabled: enabled && !!nftContract && !!chainId && nftId > 0n,
    },
    chainId,
  });

  // Check if approval is needed
  const isApproved =
    !!approvedAddress &&
    !!spender &&
    approvedAddress.toLowerCase() === spender.toLowerCase();
  const needsApproval = !!spender && !isApproved;

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

  // Refetch approval after transaction is confirmed
  useEffect(() => {
    if (isApprovalConfirmed) {
      refetchApproval();
      resetWrite();
      setApprovalError(null);
    }
  }, [isApprovalConfirmed, refetchApproval, resetWrite]);

  // Approve function
  const approve = () => {
    if (!nftContract || !spender || !chainId) {
      setApprovalError(
        new Error('Missing required parameters for NFT approval')
      );
      return;
    }

    setApprovalError(null);

    try {
      const checksummedContract = getAddress(nftContract);
      const checksummedSpender = getAddress(spender);

      writeContract({
        address: checksummedContract,
        abi: ERC721_APPROVE_ABI,
        functionName: 'approve',
        args: [checksummedSpender, nftId],
        chainId,
      });
    } catch (error) {
      setApprovalError(error as Error);
    }
  };

  return {
    // Approval state
    approvedAddress: approvedAddress as Address | undefined,
    isLoadingApproval,
    isApproved,
    needsApproval,

    // Approval transaction
    approve,
    isApproving,
    isWaitingForConfirmation,
    approvalError,
    approvalTxHash,

    // Refetch
    refetchApproval,
  };
}
