/**
 * Gas readiness transactions — deploy, register, fund
 *
 * The three steps a user may be offered before registering a close order on a
 * chain whose automation cannot yet pay for execution.
 *
 * Each transaction is built by the backend and sent verbatim. The UI never
 * assembles calldata, never derives an address, and never reads chain state.
 *
 * The deployed treasury's address comes from the readiness response, which
 * carries what the factory will produce for this environment before the
 * transaction is sent. Nothing here inspects a receipt.
 */

import { useCallback, useState } from 'react';
import { useSendTransaction } from 'wagmi';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Hash, Hex } from 'viem';
import type {
  RegisterTreasuryResponseData,
  SerializedOperatorFundingTransaction,
  SerializedTreasuryDeployTransaction,
} from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';

// ============================================================================
// Deploy
// ============================================================================

export interface UseDeployTreasuryResult {
  deploy: (tx: SerializedTreasuryDeployTransaction) => void;
  isSubmitting: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  txHash: Hash | undefined;
  error: Error | null;
  reset: () => void;
}

/**
 * Deploy a treasury by calling createTreasury() on the chain's factory.
 *
 * If the browser dies between the wallet confirming and the registration POST,
 * the treasury is deployed and unrecorded — but no longer lost. The next
 * readiness read finds it, at the address the factory was always going to use
 * or through the factory's admin index, and offers registration alone. Pressing
 * deploy again would also be safe: createTreasury is idempotent and returns the
 * existing instance rather than making a second one.
 */
export function useDeployTreasury(chainId: number): UseDeployTreasuryResult {
  const {
    sendTransaction,
    data: txHash,
    isPending: isSubmitting,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  const txWatch = useWatchTransactionStatus({
    txHash: txHash ?? null,
    chainId,
    targetConfirmations: 1,
    enabled: !!txHash,
  });

  const deploy = useCallback(
    (tx: SerializedTreasuryDeployTransaction) => {
      sendTransaction({
        to: tx.to as `0x${string}`,
        data: tx.data as Hex,
        value: BigInt(tx.value),
      });
    },
    [sendTransaction],
  );

  return {
    deploy,
    isSubmitting,
    isWaitingForConfirmation: !!txHash && txWatch.status === 'pending',
    isSuccess: txWatch.status === 'success',
    txHash,
    error: (sendError as Error) ?? null,
    reset: resetSend,
  };
}

// ============================================================================
// Register
// ============================================================================

export interface UseRegisterTreasuryResult {
  register: (address: string) => void;
  isRegistering: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Record a deployed treasury in the shared contract registry.
 *
 * Until this row exists the fee recipient resolves to the zero address and no
 * fees accrue, so the deploy on its own changes nothing.
 *
 * The server verifies on chain that the address is this environment's treasury
 * before writing, and the write is idempotent — a retry after a failed
 * registration is safe.
 */
export function useRegisterTreasury(chainId: number): UseRegisterTreasuryResult {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (address: string): Promise<RegisterTreasuryResponseData> => {
      const response = await apiClient.post<RegisterTreasuryResponseData>(
        `/api/v1/automation/gas-readiness/${chainId}/treasury`,
        { address },
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.gasReadiness.all,
      });
    },
  });

  return {
    register: mutation.mutate,
    isRegistering: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: (mutation.error as Error) ?? null,
    reset: mutation.reset,
  };
}

// ============================================================================
// Fund
// ============================================================================

export interface UseFundOperatorResult {
  fund: (tx: SerializedOperatorFundingTransaction) => void;
  isSubmitting: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  txHash: Hash | undefined;
  error: Error | null;
  reset: () => void;
}

/**
 * Transfer the fixed funding amount to the environment's operator wallet.
 *
 * This is a contribution to the instance's ability to execute orders. It is
 * not held for the user, not attributable to them, and not recoverable.
 */
export function useFundOperator(chainId: number): UseFundOperatorResult {
  const queryClient = useQueryClient();
  const [hasInvalidated, setHasInvalidated] = useState(false);

  const {
    sendTransaction,
    data: txHash,
    isPending: isSubmitting,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  const txWatch = useWatchTransactionStatus({
    txHash: txHash ?? null,
    chainId,
    targetConfirmations: 1,
    enabled: !!txHash,
    onConfirmed: () => {
      if (hasInvalidated) return;
      setHasInvalidated(true);
      queryClient.invalidateQueries({
        queryKey: queryKeys.automation.gasReadiness.all,
      });
    },
  });

  const fund = useCallback(
    (tx: SerializedOperatorFundingTransaction) => {
      sendTransaction({
        to: tx.to as `0x${string}`,
        value: BigInt(tx.value),
      });
    },
    [sendTransaction],
  );

  const reset = useCallback(() => {
    setHasInvalidated(false);
    resetSend();
  }, [resetSend]);

  return {
    fund,
    isSubmitting,
    isWaitingForConfirmation: !!txHash && txWatch.status === 'pending',
    isSuccess: txWatch.status === 'success',
    txHash,
    error: (sendError as Error) ?? null,
    reset,
  };
}
