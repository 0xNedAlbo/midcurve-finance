/**
 * useFundVault - Fund vault with ETH for gas
 *
 * Calls the depositGas() function on the SimpleTokenVault contract
 * to fund the vault with ETH for automation gas costs.
 */

import { useCallback, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useChainId,
  useSwitchChain,
} from 'wagmi';
import type { Hash, Address } from 'viem';
import { parseEther } from 'viem';
import { SimpleTokenVaultABI } from '@/lib/contracts/SimpleTokenVault';

export type FundVaultStatus =
  | 'idle'
  | 'switching_chain'
  | 'awaiting_signature'
  | 'confirming'
  | 'success'
  | 'error';

export interface FundVaultParams {
  /** Vault contract address */
  vaultAddress: Address;
  /** Target chain ID */
  chainId: number;
  /** ETH amount to deposit (as string, e.g., "0.1") */
  ethAmount: string;
}

export interface FundVaultResult {
  /** Transaction hash */
  txHash: Hash;
  /** Amount deposited in wei */
  amountWei: bigint;
}

export function useFundVault() {
  const { address: userAddress, isConnected } = useAccount();
  const currentChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [status, setStatus] = useState<FundVaultStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<FundVaultResult | null>(null);

  const fund = useCallback(
    async (params: FundVaultParams): Promise<FundVaultResult> => {
      if (!isConnected || !userAddress) {
        throw new Error('Wallet not connected');
      }
      if (!walletClient) {
        throw new Error('Wallet client not available');
      }
      if (!publicClient) {
        throw new Error('Public client not available');
      }

      setError(null);
      setResult(null);

      try {
        // Parse ETH amount
        const amountWei = parseEther(params.ethAmount);
        if (amountWei <= 0n) {
          throw new Error('ETH amount must be greater than 0');
        }

        // Switch chain if needed
        if (currentChainId !== params.chainId) {
          setStatus('switching_chain');
          await switchChainAsync({ chainId: params.chainId });
        }

        // Request user signature
        setStatus('awaiting_signature');

        // Call depositGas() with ETH value
        const hash = await walletClient.writeContract({
          address: params.vaultAddress,
          abi: SimpleTokenVaultABI,
          functionName: 'depositGas',
          value: amountWei,
        });

        // Wait for confirmation
        setStatus('confirming');
        await publicClient.waitForTransactionReceipt({ hash });

        const fundResult: FundVaultResult = {
          txHash: hash,
          amountWei,
        };

        setResult(fundResult);
        setStatus('success');

        return fundResult;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setStatus('error');
        throw error;
      }
    },
    [
      isConnected,
      userAddress,
      walletClient,
      publicClient,
      currentChainId,
      switchChainAsync,
    ]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
  }, []);

  return {
    fund,
    reset,
    status,
    error,
    result,
    isIdle: status === 'idle',
    isSwitchingChain: status === 'switching_chain',
    isAwaitingSignature: status === 'awaiting_signature',
    isConfirming: status === 'confirming',
    isSuccess: status === 'success',
    isError: status === 'error',
    isPending: ['switching_chain', 'awaiting_signature', 'confirming'].includes(status),
  };
}
