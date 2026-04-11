/**
 * useVaultCancelCloseOrder - Cancel a vault close order via user's wallet
 *
 * Vault-specific: calls cancelOrder(vault, triggerMode) on UniswapV3VaultPositionCloser.
 * Uses vault address (not nftId) and vault-specific contract resolution.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract } from 'wagmi';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hash } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { apiClientFn } from '@/lib/api-client';
import { useVaultSharedContract } from './useVaultSharedContract';
import type { OrderType } from './useCreateCloseOrder';

export interface VaultCancelCloseOrderParams {
  orderType: OrderType;
}

export interface UseVaultCancelCloseOrderResult {
  cancelOrder: (params: VaultCancelCloseOrderParams) => void;
  isCancelling: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  result: { txHash: Hash } | null;
  error: Error | null;
  reset: () => void;
  isReady: boolean;
}

export function useVaultCancelCloseOrder(
  chainId: number,
  vaultAddress: string
): UseVaultCancelCloseOrderResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ txHash: Hash } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const {
    data: sharedContract,
    isLoading: isLoadingContract,
  } = useVaultSharedContract(chainId);

  const { abi, contractAddress } = sharedContract ?? {};
  const isReady = !isLoadingContract && !!abi && !!contractAddress;

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const txWatch = useWatchTransactionStatus({
    txHash: txHash ?? null,
    chainId,
    targetConfirmations: 1,
    enabled: !!txHash,
  });
  const isWaitingForConfirmation = !!txHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isTxSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  useEffect(() => {
    if (!isTxSuccess || !txHash || result) return;

    setResult({ txHash });

    const refreshEndpoint = `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/refresh`;
    apiClientFn(refreshEndpoint, { method: 'POST' })
      .finally(() => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.positions.uniswapv3Vault.detail(chainId, vaultAddress),
        });
      });
  }, [isTxSuccess, txHash, result, queryClient, chainId, vaultAddress]);

  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  const cancelOrder = useCallback((params: VaultCancelCloseOrderParams) => {
    setResult(null);
    setError(null);

    if (!isReady || !abi || !contractAddress) {
      setError(new Error('Shared contract not ready. Please wait and try again.'));
      return;
    }

    const orderTypeMap: Record<OrderType, number> = {
      'STOP_LOSS': 0,
      'TAKE_PROFIT': 1,
    };
    const orderTypeValue = orderTypeMap[params.orderType];

    writeContract({
      address: contractAddress as Address,
      abi,
      functionName: 'cancelOrder',
      args: [vaultAddress as Address, orderTypeValue],
      chainId,
    });
  }, [writeContract, isReady, abi, contractAddress, chainId, vaultAddress]);

  const reset = useCallback(() => {
    resetWrite();
    setResult(null);
    setError(null);
  }, [resetWrite]);

  return {
    cancelOrder,
    isCancelling: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
    isReady,
  };
}
