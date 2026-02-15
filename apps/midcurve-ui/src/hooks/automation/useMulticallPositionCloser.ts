/**
 * useMulticallPositionCloser - Batch multiple PositionCloser calls into a single multicall tx
 *
 * This hook encodes an array of PositionCloser function calls as calldata,
 * sends them in a single multicall transaction, and handles confirmation
 * and cache invalidation.
 *
 * Flow:
 * 1. Caller builds an array of { functionName, args } describing each sub-call
 * 2. Hook encodes each as calldata via viem.encodeFunctionData
 * 3. User signs one multicall(...) transaction
 * 4. Wait for confirmation
 * 5. Invalidate close-order and position caches
 *
 * ABI/Contract Resolution:
 * - Default: fetches via useSharedContract(chainId, nftId) — use for existing positions
 * - Override: pass { abi, contractAddress } in options — use when nftId is not yet known
 *   (e.g. Create Position wizard uses useChainSharedContract to resolve these)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { encodeFunctionData, type Address, type Hash, type Hex } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { useSharedContract } from './useSharedContract';
import type { UniswapV3PositionCloserAbi } from '@midcurve/shared';

/**
 * A single sub-call to be included in the multicall batch.
 */
export interface PositionCloserCall {
  /** Contract function name (e.g. 'registerOrder', 'setTriggerTick', 'cancelOrder') */
  functionName: string;
  /** Arguments to the function, matching the ABI signature */
  args: readonly unknown[];
}

/**
 * Options for the multicall hook.
 * Provide abi + contractAddress to skip useSharedContract lookup
 * (useful when nftId is not yet known, e.g. during position creation).
 */
export interface UseMulticallPositionCloserOptions {
  /** Override: provide ABI directly instead of fetching via useSharedContract */
  abi?: UniswapV3PositionCloserAbi | null;
  /** Override: provide contract address directly */
  contractAddress?: Address | null;
}

/**
 * Hook result
 */
export interface UseMulticallPositionCloserResult {
  /** Execute a batch of PositionCloser calls as a single multicall tx */
  execute: (calls: PositionCloserCall[]) => void;
  /** Whether the multicall tx is pending user signature */
  isSubmitting: boolean;
  /** Whether waiting for on-chain confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether the multicall tx succeeded */
  isSuccess: boolean;
  /** Transaction hash */
  txHash: Hash | undefined;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
  /** Whether the shared contract is ready (ABI + address loaded) */
  isReady: boolean;
}

/**
 * Encode an array of PositionCloser sub-calls into bytes[] calldata for multicall.
 */
function encodeMulticallData(
  abi: UniswapV3PositionCloserAbi,
  calls: PositionCloserCall[]
): Hex[] {
  return calls.map((call) =>
    encodeFunctionData({
      abi,
      functionName: call.functionName,
      args: call.args,
    } as Parameters<typeof encodeFunctionData>[0])
  );
}

/**
 * Hook for batching multiple PositionCloser calls into a single multicall tx.
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The position NFT ID (as string). Used for useSharedContract lookup and cache invalidation.
 * @param options - Optional overrides for ABI and contractAddress (skips useSharedContract if both provided)
 */
export function useMulticallPositionCloser(
  chainId: number,
  nftId: string,
  options?: UseMulticallPositionCloserOptions
): UseMulticallPositionCloserResult {
  const queryClient = useQueryClient();
  const [error, setError] = useState<Error | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const resultSetRef = useRef(false);

  // Determine if we should use overrides or fetch from API
  const hasOverrides = !!options?.abi && !!options?.contractAddress;

  // Fetch ABI and contract address (skipped when overrides are provided —
  // passing undefined nftId disables the query via the hook's internal enabled check)
  const {
    data: sharedContract,
    isLoading: isLoadingContract,
  } = useSharedContract(
    hasOverrides ? undefined : chainId,
    hasOverrides ? undefined : (nftId || undefined)
  );

  // Resolve ABI and contractAddress from overrides or fetched data
  const abi = hasOverrides ? options!.abi! : sharedContract?.abi;
  const contractAddress = hasOverrides
    ? options!.contractAddress!
    : (sharedContract?.contractAddress as Address | undefined);
  const isReady = hasOverrides
    ? !!abi && !!contractAddress
    : !isLoadingContract && !!abi && !!contractAddress;

  // Wagmi write contract
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess: isTxSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle tx success — invalidate caches
  useEffect(() => {
    if (!isTxSuccess || !txHash || resultSetRef.current) return;
    resultSetRef.current = true;
    setHasResult(true);

    // Invalidate all close-order and position caches
    if (nftId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3.closeOrders.all(chainId, nftId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.uniswapv3.detail(chainId, nftId),
      });
    }
    queryClient.invalidateQueries({
      queryKey: queryKeys.automation.closeOrders.lists(),
    });
  }, [isTxSuccess, txHash, queryClient, chainId, nftId]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Execute multicall
  const execute = useCallback(
    (calls: PositionCloserCall[]) => {
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

  // Reset
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
