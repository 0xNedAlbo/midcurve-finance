/**
 * useMulticallVaultPositionCloser - Batch multiple VaultPositionCloser calls into a single multicall tx
 *
 * Fork of useMulticallPositionCloser for vault positions.
 * Uses vault closer ABI (vault: address instead of nftId: uint256).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWriteContract } from 'wagmi';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { useQueryClient } from '@tanstack/react-query';
import { encodeFunctionData, type Address, type Hash, type Hex } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { useVaultSharedContract } from './useVaultSharedContract';
import type { UniswapV3VaultPositionCloserAbi } from '@midcurve/shared';

export interface VaultPositionCloserCall {
  functionName: string;
  args: readonly unknown[];
}

export interface UseMulticallVaultPositionCloserOptions {
  abi?: UniswapV3VaultPositionCloserAbi | null;
  contractAddress?: Address | null;
}

export interface UseMulticallVaultPositionCloserResult {
  execute: (calls: VaultPositionCloserCall[]) => void;
  isSubmitting: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  txHash: Hash | undefined;
  error: Error | null;
  reset: () => void;
  isReady: boolean;
}

function encodeMulticallData(
  abi: UniswapV3VaultPositionCloserAbi,
  calls: VaultPositionCloserCall[]
): Hex[] {
  return calls.map((call) =>
    encodeFunctionData({
      abi,
      functionName: call.functionName,
      args: call.args,
    } as Parameters<typeof encodeFunctionData>[0])
  );
}

export function useMulticallVaultPositionCloser(
  chainId: number,
  vaultAddress: string,
  options?: UseMulticallVaultPositionCloserOptions
): UseMulticallVaultPositionCloserResult {
  const queryClient = useQueryClient();
  const [error, setError] = useState<Error | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const resultSetRef = useRef(false);

  const hasOverrides = !!options?.abi && !!options?.contractAddress;

  const {
    data: sharedContract,
    isLoading: isLoadingContract,
  } = useVaultSharedContract(
    hasOverrides ? undefined : chainId
  );

  const abi = hasOverrides ? options!.abi! : sharedContract?.abi;
  const contractAddress = hasOverrides
    ? options!.contractAddress!
    : (sharedContract?.contractAddress as Address | undefined);
  const isReady = hasOverrides
    ? !!abi && !!contractAddress
    : !isLoadingContract && !!abi && !!contractAddress;

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
    if (!isTxSuccess || !txHash || resultSetRef.current) return;
    resultSetRef.current = true;
    setHasResult(true);

    // Invalidate vault position caches
    if (vaultAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3Vault.detail(chainId, vaultAddress),
      });
    }
  }, [isTxSuccess, txHash, queryClient, chainId, vaultAddress]);

  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  const execute = useCallback(
    (calls: VaultPositionCloserCall[]) => {
      setError(null);
      setHasResult(false);
      resultSetRef.current = false;

      if (!isReady || !abi || !contractAddress) {
        setError(new Error('Shared contract not ready. Please wait and try again.'));
        return;
      }

      if (calls.length === 0) {
        setError(new Error('No operations to execute.'));
        return;
      }

      try {
        const encodedCalls = encodeMulticallData(abi, calls);

        writeContract({
          address: contractAddress as Address,
          abi,
          functionName: 'multicall',
          args: [encodedCalls],
          chainId,
        });
      } catch (e) {
        setError(
          e instanceof Error
            ? e
            : new Error('Failed to encode multicall data')
        );
      }
    },
    [writeContract, isReady, abi, contractAddress, chainId]
  );

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
    setHasResult(false);
    resultSetRef.current = false;
  }, [resetWrite]);

  return {
    execute,
    isSubmitting: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && hasResult,
    txHash,
    error,
    reset,
    isReady,
  };
}
