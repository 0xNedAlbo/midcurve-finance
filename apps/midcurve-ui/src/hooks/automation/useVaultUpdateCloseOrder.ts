/**
 * useVaultUpdateCloseOrder - Update vault close order parameters via user's wallet
 *
 * Vault-specific: calls setOperator(vault, triggerMode, newOperator) on UniswapV3VaultPositionCloser.
 * Currently only supports operator updates (needed for inactive→monitoring activation).
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract } from 'wagmi';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hash } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { useVaultSharedContract } from './useVaultSharedContract';
import type { OrderType } from './useCreateCloseOrder';

interface VaultUpdateOperatorParams {
  orderType: OrderType;
  operatorAddress: Address;
  closeOrderHash: string;
}

export interface UseVaultUpdateCloseOrderResult {
  updateOrder: (params: VaultUpdateOperatorParams) => void;
  isUpdating: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  result: { txHash: Hash } | null;
  error: Error | null;
  reset: () => void;
  isReady: boolean;
}

export function useVaultUpdateCloseOrder(
  chainId: number,
  vaultAddress: string
): UseVaultUpdateCloseOrderResult {
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

    queryClient.invalidateQueries({
      queryKey: queryKeys.positions.uniswapv3Vault.detail(chainId, vaultAddress),
    });
  }, [isTxSuccess, txHash, result, queryClient, chainId, vaultAddress]);

  useEffect(() => {
    if (writeError) setError(writeError);
    else if (receiptError) setError(receiptError);
  }, [writeError, receiptError]);

  const updateOrder = useCallback((params: VaultUpdateOperatorParams) => {
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
      functionName: 'setOperator',
      args: [vaultAddress as Address, orderTypeValue, params.operatorAddress],
      chainId,
    });
  }, [writeContract, isReady, abi, contractAddress, chainId, vaultAddress]);

  const reset = useCallback(() => {
    resetWrite();
    setResult(null);
    setError(null);
  }, [resetWrite]);

  return {
    updateOrder,
    isUpdating: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
    isReady,
  };
}
