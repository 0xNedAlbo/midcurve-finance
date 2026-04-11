/**
 * useVaultCollectFees - Collect accumulated yield from a vault position
 *
 * Calls vault.collectYield(recipient) — simpler than NFT's collect(tokenId, recipient, max0, max1).
 */

import { useWriteContract, useAccount } from 'wagmi';
import type { Address } from 'viem';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { UniswapV3VaultAbi } from '@midcurve/shared';

export interface VaultCollectFeesParams {
  vaultAddress: Address;
  chainId: number;
}

export interface UseVaultCollectFeesResult {
  collect: () => void;
  isCollecting: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  collectTxHash: Address | undefined;
  error: Error | null;
  reset: () => void;
}

export function useVaultCollectFees(
  params: VaultCollectFeesParams | null
): UseVaultCollectFeesResult {
  const { address: walletAddress } = useAccount();

  const {
    writeContract,
    data: collectTxHash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const txWatch = useWatchTransactionStatus({
    txHash: collectTxHash ?? null,
    chainId: params?.chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!collectTxHash,
  });
  const isWaitingForConfirmation = !!collectTxHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  const collect = () => {
    if (!params || !walletAddress) return;

    writeContract({
      address: params.vaultAddress,
      abi: UniswapV3VaultAbi,
      functionName: 'collectYield',
      args: [walletAddress],
      chainId: params.chainId,
    });
  };

  const reset = () => {
    resetWrite();
  };

  const error = writeError || receiptError;

  return {
    collect,
    isCollecting: isPending,
    isWaitingForConfirmation,
    isSuccess,
    collectTxHash,
    error,
    reset,
  };
}
