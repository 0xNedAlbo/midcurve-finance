import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import {
  NONFUNGIBLE_POSITION_MANAGER_ADDRESSES,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
} from '@/config/contracts/nonfungible-position-manager';

export interface BurnPositionParams {
  tokenId: bigint;
  chainId: number;
}

export interface UseBurnPositionResult {
  burn: () => void;
  isBurning: boolean;
  isWaitingForBurn: boolean;
  burnSuccess: boolean;
  burnTxHash: Address | undefined;
  burnError: Error | null;
  reset: () => void;
}

/**
 * Hook to burn a closed Uniswap V3 position NFT.
 *
 * Requires the position to already be closed (liquidity=0, tokensOwed0=0, tokensOwed1=0).
 * Calls burn(tokenId) directly on the NonfungiblePositionManager.
 */
export function useBurnPosition(params: BurnPositionParams | null): UseBurnPositionResult {
  const [burnError, setBurnError] = useState<Error | null>(null);

  const managerAddress = params?.chainId
    ? NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[params.chainId]
    : undefined;

  const {
    writeContract,
    data: burnTxHash,
    isPending: isBurning,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isWaitingForBurn,
    isSuccess: burnSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: burnTxHash,
    chainId: params?.chainId,
  });

  useEffect(() => {
    if (writeError || receiptError) {
      setBurnError(writeError || receiptError);
    }
  }, [writeError, receiptError]);

  const burn = () => {
    if (!params || !managerAddress) {
      setBurnError(new Error('Missing required parameters for burning position'));
      return;
    }

    setBurnError(null);

    try {
      writeContract({
        address: managerAddress,
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'burn',
        args: [params.tokenId],
        chainId: params.chainId,
      });
    } catch (error) {
      setBurnError(error as Error);
    }
  };

  const reset = () => {
    resetWrite();
    setBurnError(null);
  };

  return {
    burn,
    isBurning,
    isWaitingForBurn,
    burnSuccess,
    burnTxHash,
    burnError,
    reset,
  };
}
