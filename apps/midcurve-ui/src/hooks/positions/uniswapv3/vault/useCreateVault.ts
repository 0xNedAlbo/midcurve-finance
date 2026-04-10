/**
 * useCreateVault - Call createVault() on the VaultFactory and parse the VaultCreated event
 *
 * Deploys an EIP-1167 vault clone wrapping the user's UniswapV3 NFT.
 * The factory transfers the NFT from the user to the vault in a single transaction.
 *
 * Flow:
 * 1. User calls createVault(tokenId, name, symbol, decimals)
 * 2. Factory clones vault implementation + transfers NFT + initializes vault
 * 3. VaultCreated event emitted with the new vault address
 * 4. Parse vault address from transaction logs
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWriteContract } from 'wagmi';
import { decodeEventLog, type Address, type Hash } from 'viem';
import { UniswapV3VaultFactoryAbi } from '@midcurve/shared';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';

export interface UseCreateVaultResult {
  createVault: () => void;
  isCreating: boolean;
  isWaitingForConfirmation: boolean;
  isSuccess: boolean;
  vaultAddress: Address | null;
  txHash: Hash | undefined;
  error: Error | null;
  reset: () => void;
}

export interface UseCreateVaultParams {
  chainId: number | undefined;
  factoryAddress: Address | undefined;
  nftId: bigint | undefined;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  operatorAddress: Address | undefined;
}

export function useCreateVault({
  chainId,
  factoryAddress,
  nftId,
  tokenName,
  tokenSymbol,
  decimals,
  operatorAddress,
}: UseCreateVaultParams): UseCreateVaultResult {
  const [error, setError] = useState<Error | null>(null);
  const [vaultAddress, setVaultAddress] = useState<Address | null>(null);

  const {
    writeContract,
    data: txHash,
    isPending: isCreating,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const txWatch = useWatchTransactionStatus({
    txHash: txHash ?? null,
    chainId: chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!txHash,
  });
  const isWaitingForConfirmation = !!txHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const isSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Vault creation transaction reverted') : null;

  // Parse VaultCreated event from transaction logs to extract vault address
  useEffect(() => {
    if (!isSuccess || !txWatch.logs || vaultAddress) return;

    for (const log of txWatch.logs) {
      // Match logs from the factory address
      if (factoryAddress && log.address.toLowerCase() !== factoryAddress.toLowerCase()) continue;

      const decoded = decodeEventLog({
        abi: UniswapV3VaultFactoryAbi,
        data: log.data as `0x${string}`,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });

      if (decoded.eventName === 'VaultCreated') {
        setVaultAddress(decoded.args.vault);
        break;
      }
    }
  }, [isSuccess, txWatch.logs, factoryAddress, vaultAddress]);

  // Handle errors
  useEffect(() => {
    if (writeError) {
      setError(writeError);
    } else if (receiptError) {
      setError(receiptError);
    }
  }, [writeError, receiptError]);

  const createVault = useCallback(() => {
    if (!factoryAddress || !chainId || nftId === undefined || !operatorAddress) {
      setError(new Error('Missing required parameters for vault creation'));
      return;
    }

    setError(null);
    setVaultAddress(null);

    writeContract({
      address: factoryAddress,
      abi: UniswapV3VaultFactoryAbi,
      functionName: 'createVault',
      args: [nftId, tokenName, tokenSymbol, decimals, operatorAddress],
      chainId,
    } as any); // cast needed for strict tuple ABI type inference
  }, [factoryAddress, chainId, nftId, tokenName, tokenSymbol, decimals, operatorAddress, writeContract]);

  const reset = useCallback(() => {
    resetWrite();
    setError(null);
    setVaultAddress(null);
  }, [resetWrite]);

  return useMemo(() => ({
    createVault,
    isCreating,
    isWaitingForConfirmation,
    isSuccess,
    vaultAddress,
    txHash,
    error,
    reset,
  }), [createVault, isCreating, isWaitingForConfirmation, isSuccess, vaultAddress, txHash, error, reset]);
}
