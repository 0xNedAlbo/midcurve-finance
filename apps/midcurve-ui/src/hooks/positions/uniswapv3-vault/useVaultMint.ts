/**
 * useVaultMint - Mint new vault shares by depositing tokens
 *
 * Calls vault.mint(minShares, params) where params = { maxAmounts, minAmounts, recipient, deadline }.
 * Monitors confirmation via backend transaction status subscription.
 */

import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useAccount } from 'wagmi';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { UniswapV3VaultAbi } from '@midcurve/shared';

export interface VaultMintParams {
  vaultAddress: Address;
  maxAmount0: bigint;
  maxAmount1: bigint;
  chainId: number;
  /** Expected shares to mint (before slippage). Used to compute minShares. */
  expectedShares: bigint;
  /** Slippage in basis points (default: 50 = 0.5%) */
  slippageBps?: number;
}

export interface UseVaultMintResult {
  mint: () => void;
  isMinting: boolean;
  isWaitingForConfirmation: boolean;
  mintError: Error | null;
  mintTxHash: Address | undefined;
  isSuccess: boolean;
  reset: () => void;
}

/**
 * Hook to mint vault shares by depositing proportional token amounts.
 *
 * Handles:
 * - Slippage-adjusted minShares (default 0.5%)
 * - Slippage-adjusted minAmounts per token
 * - 20-minute transaction deadline
 * - Recipient = connected wallet
 */
export function useVaultMint(
  params: VaultMintParams | null
): UseVaultMintResult {
  const [mintError, setMintError] = useState<Error | null>(null);
  const { address: walletAddress } = useAccount();

  const slippageBps = params?.slippageBps ?? 50;

  const {
    writeContract,
    data: mintTxHash,
    isPending: isMinting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const txWatch = useWatchTransactionStatus({
    txHash: mintTxHash ?? null,
    chainId: params?.chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!mintTxHash,
  });
  const isWaitingForConfirmation = !!mintTxHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  useEffect(() => {
    if (writeError || receiptError) {
      setMintError(writeError || receiptError);
    }
  }, [writeError, receiptError]);

  const mint = () => {
    if (!params || !walletAddress) {
      setMintError(new Error('Missing required parameters for vault mint'));
      return;
    }

    setMintError(null);

    const minShares = (params.expectedShares * BigInt(10000 - slippageBps)) / 10000n;
    const minAmount0 = (params.maxAmount0 * BigInt(10000 - slippageBps)) / 10000n;
    const minAmount1 = (params.maxAmount1 * BigInt(10000 - slippageBps)) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

    writeContract({
      address: params.vaultAddress,
      abi: UniswapV3VaultAbi,
      functionName: 'mint',
      args: [
        minShares,
        {
          maxAmounts: [params.maxAmount0, params.maxAmount1],
          minAmounts: [minAmount0, minAmount1],
          recipient: walletAddress,
          deadline,
        },
      ],
      chainId: params.chainId,
    });
  };

  const reset = () => {
    resetWrite();
    setMintError(null);
  };

  return {
    mint,
    isMinting,
    isWaitingForConfirmation,
    mintError,
    mintTxHash,
    isSuccess,
    reset,
  };
}
