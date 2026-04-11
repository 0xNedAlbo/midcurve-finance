/**
 * useVaultBurn - Burn vault shares to withdraw proportional tokens
 *
 * Calls vault.burn(shares, params) where params = { minAmounts, recipient, deadline }.
 * Single transaction — no multicall needed (unlike NFT's decreaseLiquidity + collect).
 */

import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useAccount } from 'wagmi';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { UniswapV3VaultAbi } from '@midcurve/shared';

export interface VaultBurnParams {
  vaultAddress: Address;
  /** Number of shares to burn */
  shares: bigint;
  /** Expected token0 amount from quoteBurn (before slippage) */
  expectedAmount0: bigint;
  /** Expected token1 amount from quoteBurn (before slippage) */
  expectedAmount1: bigint;
  chainId: number;
  /** Slippage in basis points (default: 100 = 1%) */
  slippageBps?: number;
}

export interface UseVaultBurnResult {
  withdraw: () => void;
  isWithdrawing: boolean;
  isWaitingForWithdraw: boolean;
  withdrawError: Error | null;
  withdrawTxHash: Address | undefined;
  isSuccess: boolean;
  currentStep: 'idle' | 'withdrawing' | 'complete';
  reset: () => void;
}

export function useVaultBurn(params: VaultBurnParams | null): UseVaultBurnResult {
  const [withdrawError, setWithdrawError] = useState<Error | null>(null);
  const [currentStep, setCurrentStep] = useState<'idle' | 'withdrawing' | 'complete'>('idle');
  const { address: walletAddress } = useAccount();

  const slippageBps = params?.slippageBps ?? 100;

  const {
    writeContract,
    data: withdrawTxHash,
    isPending: isWithdrawing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const txWatch = useWatchTransactionStatus({
    txHash: withdrawTxHash ?? null,
    chainId: params?.chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!withdrawTxHash,
  });
  const isWaitingForWithdraw = !!withdrawTxHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  useEffect(() => {
    if (writeError || receiptError) {
      setWithdrawError(writeError || receiptError);
      setCurrentStep('idle');
    }
  }, [writeError, receiptError]);

  useEffect(() => {
    if (isWithdrawing || isWaitingForWithdraw) {
      setCurrentStep('withdrawing');
    } else if (isSuccess) {
      setCurrentStep('complete');
    }
  }, [isWithdrawing, isWaitingForWithdraw, isSuccess]);

  const withdraw = () => {
    if (!params || !walletAddress) {
      setWithdrawError(new Error('Missing required parameters for vault burn'));
      return;
    }

    setWithdrawError(null);
    setCurrentStep('withdrawing');

    const slippageMultiplier = BigInt(10000 - slippageBps);
    const minAmount0 = (params.expectedAmount0 * slippageMultiplier) / 10000n;
    const minAmount1 = (params.expectedAmount1 * slippageMultiplier) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

    writeContract({
      address: params.vaultAddress,
      abi: UniswapV3VaultAbi,
      functionName: 'burn',
      args: [
        params.shares,
        {
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
    setWithdrawError(null);
    setCurrentStep('idle');
  };

  return {
    withdraw,
    isWithdrawing,
    isWaitingForWithdraw,
    withdrawError,
    withdrawTxHash,
    isSuccess,
    currentStep,
    reset,
  };
}
