/**
 * useDeployAutomationContract - Deploy automation contract via user's wallet
 *
 * This hook allows users to deploy their UniswapV3PositionCloser contract
 * using their connected wallet (Wagmi).
 *
 * Constructor args are built locally using:
 * - nfpmAddress: hardcoded per chain (from nonfungible-position-manager.ts)
 * - operatorAddress: autowallet address (from useAutowallet hook)
 *
 * Flow:
 * 1. User calls deploy()
 * 2. Fetch bytecode from API (just bytecode, no args)
 * 3. Build constructor args locally (nfpm + operator)
 * 4. User signs deploy transaction in their wallet (Wagmi)
 * 5. Wait for tx confirmation
 * 6. Extract contract address from receipt
 * 7. Notify API: POST /api/v1/automation/contracts/notify
 * 8. Return the created contract
 */

import { useState, useEffect, useCallback } from 'react';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { encodeAbiParameters } from 'viem';
import type { Address, Hash, Hex } from 'viem';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';
import { useAutowallet } from './useAutowallet';
import type { SerializedAutomationContract } from '@midcurve/api-shared';

/**
 * Parameters for deploying an automation contract
 */
export interface DeployContractParams {
  /** Chain ID to deploy on */
  chainId: number;
  /** Contract type to deploy */
  contractType: 'uniswapv3';
}

/**
 * Result from deploying a contract
 */
export interface DeployContractResult {
  /** The deployed contract address */
  contractAddress: Address;
  /** Transaction hash */
  txHash: Hash;
  /** The created contract record (after API notification) */
  contract?: SerializedAutomationContract;
}

/**
 * Hook result
 */
export interface UseDeployAutomationContractResult {
  /** Deploy a new automation contract */
  deploy: (params: DeployContractParams) => void;
  /** Whether fetching bytecode */
  isFetchingBytecode: boolean;
  /** Whether a deployment is in progress */
  isDeploying: boolean;
  /** Whether waiting for transaction confirmation */
  isWaitingForConfirmation: boolean;
  /** Whether the deployment was successful */
  isSuccess: boolean;
  /** The result data (contractAddress, txHash, contract) */
  result: DeployContractResult | null;
  /** Any error that occurred */
  error: Error | null;
  /** Reset the hook state */
  reset: () => void;
  /** Whether autowallet is loaded (required for deployment) */
  isAutowalletReady: boolean;
  /** Whether autowallet exists (required for deployment) */
  hasAutowallet: boolean;
}

/**
 * Hook for deploying an automation contract via user's wallet
 */
export function useDeployAutomationContract(): UseDeployAutomationContractResult {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<DeployContractResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentParams, setCurrentParams] = useState<DeployContractParams | null>(null);
  const [isFetchingBytecode, setIsFetchingBytecode] = useState(false);

  // Get autowallet data (operator address)
  const { data: autowallet, isLoading: isAutowalletLoading } = useAutowallet();
  const isAutowalletReady = !isAutowalletLoading;
  const hasAutowallet = !!autowallet?.address;

  // Wagmi send transaction hook (for contract deployment)
  const {
    sendTransaction,
    data: txHash,
    isPending: isSendPending,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();

  // Wait for transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess: isTxSuccess,
    data: receipt,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle transaction success - extract address and notify API
  useEffect(() => {
    if (!isTxSuccess || !receipt || !txHash || !currentParams) return;

    const handleSuccess = async () => {
      try {
        // Get deployed contract address from receipt
        const contractAddress = receipt.contractAddress;

        if (!contractAddress) {
          throw new Error('Failed to get deployed contract address from transaction receipt');
        }

        // Notify API about the deployed contract
        try {
          const response = await automationApi.notifyContractDeployed({
            chainId: currentParams.chainId,
            contractType: currentParams.contractType,
            contractAddress,
            txHash,
          });

          setResult({
            contractAddress,
            txHash,
            contract: response.data,
          });
        } catch (apiError) {
          // Even if API notification fails, the on-chain tx succeeded
          console.error('Failed to notify API of contract deployment:', apiError);
          setResult({
            contractAddress,
            txHash,
          });
        }

        // Invalidate contract query cache
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.contracts.byChain(currentParams.chainId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.automation.contracts.lists(),
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    };

    handleSuccess();
  }, [isTxSuccess, receipt, txHash, currentParams, queryClient]);

  // Handle errors
  useEffect(() => {
    if (sendError) {
      setError(sendError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [sendError, receiptError]);

  // Deploy function
  const deploy = useCallback(async (params: DeployContractParams) => {
    // Reset state
    setResult(null);
    setError(null);
    setCurrentParams(params);

    // Validate prerequisites
    if (!hasAutowallet || !autowallet?.address) {
      setError(new Error('No autowallet found. Please create an autowallet in Settings first.'));
      return;
    }

    const nfpmAddress = getNonfungiblePositionManagerAddress(params.chainId);
    if (!nfpmAddress) {
      setError(new Error(`Chain ${params.chainId} is not supported for Uniswap V3`));
      return;
    }

    setIsFetchingBytecode(true);

    try {
      // Fetch bytecode from API (just bytecode, no constructor args)
      const bytecodeResponse = await automationApi.getContractBytecode(
        params.chainId,
        params.contractType
      );

      const { bytecode } = bytecodeResponse.data;

      // Build constructor args locally
      // UniswapV3PositionCloser constructor: (address _positionManager, address _operator)
      const constructorArgs = encodeAbiParameters(
        [
          { type: 'address', name: '_positionManager' },
          { type: 'address', name: '_operator' },
        ],
        [nfpmAddress, autowallet.address as Address]
      );

      // Combine bytecode with constructor args
      const deployData = (bytecode + constructorArgs.slice(2)) as Hex;

      setIsFetchingBytecode(false);

      // Send deployment transaction
      sendTransaction({
        chainId: params.chainId,
        data: deployData,
        // to is undefined for contract deployment
      });
    } catch (err) {
      setIsFetchingBytecode(false);
      setError(err instanceof Error ? err : new Error('Failed to fetch contract bytecode'));
    }
  }, [sendTransaction, hasAutowallet, autowallet?.address]);

  // Reset function
  const reset = useCallback(() => {
    resetSend();
    setResult(null);
    setError(null);
    setCurrentParams(null);
    setIsFetchingBytecode(false);
  }, [resetSend]);

  return {
    deploy,
    isFetchingBytecode,
    isDeploying: isSendPending,
    isWaitingForConfirmation,
    isSuccess: isTxSuccess && result !== null,
    result,
    error,
    reset,
    isAutowalletReady,
    hasAutowallet,
  };
}
