/**
 * useCreateCloseOrder - Register a close order via user's wallet
 *
 * This hook uses Wagmi to have the user sign the registerOrder transaction
 * directly with their connected wallet. After confirmation, it notifies
 * the API to start monitoring the order.
 *
 * Flow:
 * 1. Hook fetches ABI and contract address via useSharedContract
 * 2. User calls registerOrder()
 * 3. User signs registerOrder() tx in their wallet (Wagmi)
 * 4. Wait for tx confirmation
 * 5. Parse OrderRegistered event
 * 6. POST to /api/v1/automation/close-orders with all order details
 * 7. Return the created order
 *
 * V1.0 Interface (tick-based):
 * - Uses triggerTick (int24) instead of sqrtPriceX96 bounds
 * - Uses orderType (STOP_LOSS=0, TAKE_PROFIT=1) instead of triggerMode
 * - Orders identified by (nftId, orderType) - one SL and one TP per position
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { decodeEventLog, type Address, type Hash, type TransactionReceipt } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { useSharedContract } from './useSharedContract';
import type { SerializedCloseOrder } from '@midcurve/api-shared';
import { tickToSqrtRatioX96, type UniswapV3PositionCloserAbi } from '@midcurve/shared';

/**
 * Order type for the contract (V1.0 interface)
 */
export type OrderType = 'STOP_LOSS' | 'TAKE_PROFIT';

/**
 * Swap configuration for post-close swap
 */
export interface SwapConfig {
  enabled: boolean;
  direction: 'TOKEN0_TO_1' | 'TOKEN1_TO_0';
  slippageBps: number;
}

/**
 * Parameters for registering a close order (V1.0 tick-based interface)
 * Note: ABI and contract address are fetched internally via useSharedContract
 */
export interface RegisterCloseOrderParams {
  /** Pool address */
  poolAddress: Address;
  /** Order type: STOP_LOSS or TAKE_PROFIT */
  orderType: OrderType;
  /** Trigger tick (int24) - price level that triggers the order */
  triggerTick: number;
  /** Address to receive funds after close */
  payoutAddress: Address;
  /** Operator address (user's autowallet) */
  operatorAddress: Address;
  /** Unix timestamp when order expires */
  validUntil: bigint;
  /** Slippage tolerance in basis points (e.g., 100 = 1%) */
  slippageBps: number;
  /** Position ID for API notification and cache invalidation */
  positionId: string;
  /** Position owner address (for pre-flight ownership check) */
  positionOwner: Address;
  /** Optional swap configuration for post-close swap */
  swapConfig?: SwapConfig;
}

/**
 * Result from creating a close order
 */
export interface CreateCloseOrderResult {
  /** Transaction hash */
  txHash: Hash;
  /** The created order (after API notification) */
  order?: SerializedCloseOrder;
}

/**
 * Hook result
 */
export interface UseCreateCloseOrderResult {
  /** Register a new close order */
  registerOrder: (params: RegisterCloseOrderParams) => void;
  /** Whether a registration is in progress */
  isRegistering: boolean;
  /** Whether waiting for transaction confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether the registration was successful (tx confirmed AND API notified) */
  isSuccess: boolean;
  /** The result data (txHash, order) */
  result: CreateCloseOrderResult | null;
  /** Any error that occurred (wallet tx error) */
  error: Error | null;
  /** API notification error (tx succeeded but API failed) */
  apiError: Error | null;
  /** Reset the hook state */
  reset: () => void;
  /** Whether the shared contract is ready (ABI loaded) */
  isReady: boolean;
}

/**
 * Parse OrderRegistered event from transaction receipt (V1.0 interface)
 * Returns true if the event was found (order was registered)
 */
function parseOrderRegisteredEvent(
  receipt: TransactionReceipt,
  contractAddress: Address,
  abi: UniswapV3PositionCloserAbi
): boolean {
  try {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === 'OrderRegistered') {
          return true;
        }
      } catch {
        // Not this event, continue
      }
    }
    return false;
  } catch (error) {
    console.error('Failed to parse OrderRegistered event:', error);
    return false;
  }
}

/**
 * Hook for creating a close order via user's wallet (V1.0 tick-based interface)
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The position NFT ID (as string)
 */
export function useCreateCloseOrder(
  chainId: number,
  nftId: string
): UseCreateCloseOrderResult {
  const queryClient = useQueryClient();
  const { address: connectedAddress } = useAccount();
  const [result, setResult] = useState<CreateCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [apiError, setApiError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<RegisterCloseOrderParams | null>(null);

  // Fetch ABI and contract address from shared contract API
  const {
    data: sharedContract,
    isLoading: isLoadingContract,
  } = useSharedContract(chainId, nftId);

  const { abi, contractAddress, positionManager } = sharedContract ?? {};
  const isReady = !isLoadingContract && !!abi && !!contractAddress && !!positionManager;

  // Wagmi write contract hook
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess: isTxSuccess,
    data: receipt,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle transaction success - parse event and notify API
  useEffect(() => {
    if (!isTxSuccess || !receipt || !txHash || !currentParams || !abi || !contractAddress || !positionManager) return;

    const handleSuccess = async () => {
      try {
        // Verify OrderRegistered event was emitted
        const eventFound = parseOrderRegisteredEvent(
          receipt,
          contractAddress as Address,
          abi
        );

        if (!eventFound) {
          throw new Error('Failed to find OrderRegistered event in transaction');
        }

        // Build validUntil as ISO string
        const validUntilDate = new Date(Number(currentParams.validUntil) * 1000);

        // Create close order via position-scoped API
        // Map orderType to triggerMode for API
        const triggerModeMap: Record<OrderType, 'LOWER' | 'UPPER'> = {
          'STOP_LOSS': 'LOWER',
          'TAKE_PROFIT': 'UPPER',
        };
        const triggerMode = triggerModeMap[currentParams.orderType];

        // Convert triggerTick to sqrtPriceX96 for API
        const triggerSqrtPriceX96 = tickToSqrtRatioX96(currentParams.triggerTick).toString();

        // Compute closeOrderHash: {sl|tp}@{tick}
        const hashPrefix = currentParams.orderType === 'STOP_LOSS' ? 'sl' : 'tp';
        const closeOrderHash = `${hashPrefix}@${currentParams.triggerTick}`;

        try {
          const response = await automationApi.positionCloseOrders.create(
            chainId,
            nftId,
            closeOrderHash,
            {
              poolAddress: currentParams.poolAddress,
              operatorAddress: currentParams.operatorAddress,
              positionManager,
              triggerMode,
              sqrtPriceX96: triggerSqrtPriceX96,
              payoutAddress: currentParams.payoutAddress,
              validUntil: validUntilDate.toISOString(),
              slippageBps: currentParams.slippageBps,
              registrationTxHash: txHash,
              swapConfig: currentParams.swapConfig,
            }
          );

          setResult({
            txHash,
            order: response.data,
          });
        } catch (err) {
          // On-chain tx succeeded but API notification failed
          // Surface this error to the user - they need to know the order
          // may not be monitored properly
          console.error('Failed to notify API of close order:', err);
          const errorMessage = err instanceof Error
            ? err.message
            : 'Failed to register order with monitoring service';
          setApiError(new Error(errorMessage));
          // Still set result with txHash so user knows the tx succeeded
          setResult({
            txHash,
          });
        }

        // Invalidate caches
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.closeOrders.byPosition(currentParams.positionId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.closeOrders.lists(),
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    };

    handleSuccess();
  }, [isTxSuccess, receipt, txHash, currentParams, queryClient, abi, contractAddress, positionManager, chainId, nftId]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Register function - calls registerOrder on shared contract (V1.0 interface)
  const registerOrder = useCallback((params: RegisterCloseOrderParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setApiError(null);
    setCurrentParams(params);

    // Pre-flight check: verify shared contract is ready
    if (!isReady || !abi || !contractAddress) {
      setError(new Error('Shared contract not ready. Please wait and try again.'));
      return;
    }

    // Pre-flight check: verify connected wallet matches position owner
    if (!connectedAddress) {
      setError(new Error('No wallet connected. Please connect your wallet first.'));
      return;
    }

    if (connectedAddress.toLowerCase() !== params.positionOwner.toLowerCase()) {
      setError(new Error(
        `Wrong wallet connected. The position is owned by ${params.positionOwner}, ` +
        `but you are connected with ${connectedAddress}. ` +
        `Please switch to the wallet that owns this position.`
      ));
      return;
    }

    // Map OrderType to contract TriggerMode enum value
    // Contract: LOWER = 0, UPPER = 1
    // UI: STOP_LOSS maps to LOWER, TAKE_PROFIT maps to UPPER
    const orderTypeMap: Record<OrderType, number> = {
      'STOP_LOSS': 0,   // LOWER
      'TAKE_PROFIT': 1, // UPPER
    };
    const triggerModeValue = orderTypeMap[params.orderType];

    // Map SwapDirection
    // Contract: NONE = 0, TOKEN0_TO_1 = 1, TOKEN1_TO_0 = 2
    const swapDirectionMap: Record<string, number> = {
      'NONE': 0,
      'TOKEN0_TO_1': 1,
      'TOKEN1_TO_0': 2,
    };

    const swapDirection = params.swapConfig?.enabled
      ? swapDirectionMap[params.swapConfig.direction]
      : 0;

    const swapSlippageBps = params.swapConfig?.enabled
      ? params.swapConfig.slippageBps
      : 0;

    // Call writeContract with registerOrder function (V1.0 interface)
    writeContract({
      address: contractAddress as Address,
      abi,
      functionName: 'registerOrder',
      args: [
        {
          nftId: BigInt(nftId),
          pool: params.poolAddress,
          triggerMode: triggerModeValue,
          triggerTick: params.triggerTick,
          payout: params.payoutAddress,
          operator: params.operatorAddress,
          validUntil: params.validUntil,
          slippageBps: params.slippageBps,
          swapDirection,
          swapSlippageBps,
        },
      ],
      chainId,
    });
  }, [writeContract, connectedAddress, isReady, abi, contractAddress, chainId, nftId]);

  // Reset function
  const reset = useCallback(() => {
    resetWrite();
    setResult(null);
    setError(null);
    setApiError(null);
    setCurrentParams(null);
  }, [resetWrite]);

  return {
    registerOrder,
    isRegistering: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null && apiError === null,
    result,
    error,
    apiError,
    reset,
    isReady,
  };
}

export type { SerializedCloseOrder };
