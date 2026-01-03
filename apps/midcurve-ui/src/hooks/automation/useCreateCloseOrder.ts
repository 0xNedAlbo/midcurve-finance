/**
 * useCreateCloseOrder - Register a close order via user's wallet
 *
 * This hook uses Wagmi to have the user sign the registerClose transaction
 * directly with their connected wallet. After confirmation, it notifies
 * the API to start monitoring the order.
 *
 * Flow:
 * 1. User calls registerOrder()
 * 2. User signs registerClose() tx in their wallet (Wagmi)
 * 3. Wait for tx confirmation
 * 4. Parse CloseRegistered event for closeId
 * 5. POST to /api/v1/automation/close-orders with all order details
 * 6. Return the created order
 */

import { useState, useEffect, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { decodeEventLog, type Address, type Hash, type TransactionReceipt } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { POSITION_CLOSER_ABI } from '@/config/contracts/uniswapv3-position-closer';
import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';

/**
 * Parameters for registering a close order
 */
export interface RegisterCloseOrderParams {
  /** Shared automation contract address on this chain */
  contractAddress: Address;
  /** Position manager (NFPM) address for this chain */
  positionManager: Address;
  /** Chain ID */
  chainId: number;
  /** NFT token ID of the position */
  nftId: bigint;
  /** Lower price trigger (sqrtPriceX96) */
  sqrtPriceX96Lower: bigint;
  /** Upper price trigger (sqrtPriceX96) */
  sqrtPriceX96Upper: bigint;
  /** Address to receive funds after close */
  payoutAddress: Address;
  /** Operator address (user's autowallet) */
  operatorAddress: Address;
  /** Unix timestamp when order expires */
  validUntil: bigint;
  /** Slippage tolerance in basis points (e.g., 100 = 1%) */
  slippageBps: number;
  /** Trigger mode (LOWER, UPPER, or BOTH) */
  triggerMode: TriggerMode;
  /** Position ID for API notification and cache invalidation */
  positionId: string;
  /** Pool address for API notification */
  poolAddress: Address;
  /** Position owner address (for pre-flight ownership check) */
  positionOwner: Address;
}

/**
 * Result from creating a close order
 */
export interface CreateCloseOrderResult {
  /** The on-chain close order ID */
  closeId: bigint;
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
  /** Whether the registration was successful */
  isSuccess: boolean;
  /** The result data (closeId, txHash, order) */
  result: CreateCloseOrderResult | null;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
}

/**
 * Parse CloseRegistered event from transaction receipt
 */
function parseCloseRegisteredEvent(
  receipt: TransactionReceipt,
  contractAddress: Address
): bigint | null {
  console.log('[parseCloseRegisteredEvent] Parsing receipt:', {
    contractAddress,
    logsCount: receipt.logs.length,
    logs: receipt.logs.map((log) => ({
      address: log.address,
      topics: log.topics,
      data: log.data,
    })),
  });

  try {
    // Find the CloseRegistered event
    for (const log of receipt.logs) {
      console.log('[parseCloseRegisteredEvent] Checking log from:', log.address);

      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
        console.log('[parseCloseRegisteredEvent] Skipping - address mismatch');
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi: POSITION_CLOSER_ABI,
          data: log.data,
          topics: log.topics,
        });

        console.log('[parseCloseRegisteredEvent] Decoded event:', {
          eventName: decoded.eventName,
          args: decoded.args,
        });

        if (decoded.eventName === 'CloseRegistered') {
          // The closeId is the first indexed parameter
          const closeId = (decoded.args as { closeId: bigint }).closeId;
          console.log('[parseCloseRegisteredEvent] Found closeId:', closeId);
          return closeId;
        }
      } catch (decodeError) {
        console.log('[parseCloseRegisteredEvent] Failed to decode log:', decodeError);
        // Not this event, continue
      }
    }
    console.log('[parseCloseRegisteredEvent] No CloseRegistered event found');
    return null;
  } catch (error) {
    console.error('Failed to parse CloseRegistered event:', error);
    return null;
  }
}

/**
 * Hook for creating a close order via user's wallet
 */
export function useCreateCloseOrder(): UseCreateCloseOrderResult {
  const queryClient = useQueryClient();
  const { address: connectedAddress } = useAccount();
  const [result, setResult] = useState<CreateCloseOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<RegisterCloseOrderParams | null>(null);

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
    if (!isTxSuccess || !receipt || !txHash || !currentParams) return;

    const handleSuccess = async () => {
      try {
        // Parse closeId from event
        const closeId = parseCloseRegisteredEvent(receipt, currentParams.contractAddress);

        if (closeId === null) {
          throw new Error('Failed to parse CloseRegistered event from transaction');
        }

        // Build validUntil as ISO string
        const validUntilDate = new Date(Number(currentParams.validUntil) * 1000);

        // Create close order via API
        try {
          const response = await automationApi.createCloseOrder({
            closeOrderType: 'uniswapv3',
            positionId: currentParams.positionId,
            automationContractConfig: {
              chainId: currentParams.chainId,
              contractAddress: currentParams.contractAddress,
              positionManager: currentParams.positionManager,
            },
            closeId: Number(closeId),
            nftId: currentParams.nftId.toString(),
            poolAddress: currentParams.poolAddress,
            operatorAddress: currentParams.operatorAddress,
            triggerMode: currentParams.triggerMode,
            sqrtPriceX96Lower: currentParams.sqrtPriceX96Lower.toString(),
            sqrtPriceX96Upper: currentParams.sqrtPriceX96Upper.toString(),
            payoutAddress: currentParams.payoutAddress,
            validUntil: validUntilDate.toISOString(),
            slippageBps: currentParams.slippageBps,
            registrationTxHash: txHash,
          });

          setResult({
            closeId,
            txHash,
            order: response.data,
          });
        } catch (apiError) {
          // Even if API notification fails, the on-chain tx succeeded
          console.error('Failed to notify API of close order:', apiError);
          setResult({
            closeId,
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
  }, [isTxSuccess, receipt, txHash, currentParams, queryClient]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      console.log('[useCreateCloseOrder] writeError:', {
        name: writeError.name,
        message: writeError.message,
        cause: writeError.cause,
        stack: writeError.stack,
      });
      setError(writeError);
    } else if (receiptError) {
      console.log('[useCreateCloseOrder] receiptError:', {
        name: receiptError.name,
        message: receiptError.message,
        cause: receiptError.cause,
        stack: receiptError.stack,
      });
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  // Register function - calls registerClose on shared contract with operator
  const registerOrder = useCallback((params: RegisterCloseOrderParams) => {
    console.log('[useCreateCloseOrder] registerOrder called', {
      connectedAddress,
      positionOwner: params.positionOwner,
    });

    // Reset state
    setResult(null);
    setError(null);
    setCurrentParams(params);

    // Pre-flight check: verify connected wallet matches position owner
    if (!connectedAddress) {
      console.log('[useCreateCloseOrder] No wallet connected');
      setError(new Error('No wallet connected. Please connect your wallet first.'));
      return;
    }

    if (connectedAddress.toLowerCase() !== params.positionOwner.toLowerCase()) {
      console.log('[useCreateCloseOrder] Wallet mismatch detected!', {
        connected: connectedAddress.toLowerCase(),
        owner: params.positionOwner.toLowerCase(),
      });
      setError(new Error(
        `Wrong wallet connected. The position is owned by ${params.positionOwner}, ` +
        `but you are connected with ${connectedAddress}. ` +
        `Please switch to the wallet that owns this position.`
      ));
      return;
    }

    console.log('[useCreateCloseOrder] Wallet check passed, calling writeContract');

    // Map TriggerMode string to contract enum value
    // Contract: LOWER_ONLY = 0, UPPER_ONLY = 1, BOTH = 2
    const triggerModeMap: Record<string, number> = {
      'LOWER': 0,
      'UPPER': 1,
      'BOTH': 2,
    };
    const mode = triggerModeMap[params.triggerMode] ?? 0;

    // Build the CloseConfig struct for logging
    const closeConfig = {
      pool: params.poolAddress,
      tokenId: params.nftId.toString(),
      sqrtPriceX96Lower: params.sqrtPriceX96Lower.toString(),
      sqrtPriceX96Upper: params.sqrtPriceX96Upper.toString(),
      mode,
      payout: params.payoutAddress,
      operator: params.operatorAddress,
      validUntil: params.validUntil.toString(),
      slippageBps: params.slippageBps,
    };

    console.log('[useCreateCloseOrder] writeContract params:', {
      contractAddress: params.contractAddress,
      chainId: params.chainId,
      functionName: 'registerClose',
      closeConfig,  // Single struct argument
    });

    // Call writeContract with registerClose function
    // Contract takes CloseConfig struct as a single tuple argument
    writeContract({
      address: params.contractAddress,
      abi: POSITION_CLOSER_ABI,
      functionName: 'registerClose',
      args: [
        {
          pool: params.poolAddress,
          tokenId: params.nftId,
          sqrtPriceX96Lower: params.sqrtPriceX96Lower,
          sqrtPriceX96Upper: params.sqrtPriceX96Upper,
          mode,
          payout: params.payoutAddress,
          operator: params.operatorAddress,
          validUntil: params.validUntil,
          slippageBps: params.slippageBps,
        },
      ],
      chainId: params.chainId,
    });
  }, [writeContract, connectedAddress]);

  // Reset function
  const reset = useCallback(() => {
    resetWrite();
    setResult(null);
    setError(null);
    setCurrentParams(null);
  }, [resetWrite]);

  return {
    registerOrder,
    isRegistering: isWritePending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
  };
}

export type { SerializedCloseOrder };
