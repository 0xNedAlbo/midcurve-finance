/**
 * useDeployVault - Deploy SimpleTokenVault contract from user's wallet
 *
 * Uses wagmi to deploy the vault contract on the target chain.
 * Returns the deployed contract address after confirmation.
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
import { SimpleTokenVaultABI } from '@/lib/contracts/SimpleTokenVault';

export type DeployVaultStatus =
  | 'idle'
  | 'switching_chain'
  | 'awaiting_signature'
  | 'confirming'
  | 'success'
  | 'error';

export interface DeployVaultParams {
  /** Target chain ID for deployment */
  chainId: number;
  /** Compiled bytecode (0x prefixed) */
  bytecode: `0x${string}`;
  /** Constructor params: owner, operator, token */
  constructorParams: {
    owner: Address;
    operator: Address;
    token: Address;
  };
}

export interface DeployVaultResult {
  /** Deployed vault contract address */
  vaultAddress: Address;
  /** Deployment transaction hash */
  deployTxHash: Hash;
}

export function useDeployVault() {
  const { address: userAddress, isConnected } = useAccount();
  const currentChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [status, setStatus] = useState<DeployVaultStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<DeployVaultResult | null>(null);

  const deploy = useCallback(
    async (params: DeployVaultParams): Promise<DeployVaultResult> => {
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
        // Switch chain if needed
        if (currentChainId !== params.chainId) {
          setStatus('switching_chain');
          await switchChainAsync({ chainId: params.chainId });
        }

        // Request user signature for deployment
        setStatus('awaiting_signature');

        const { owner, operator, token } = params.constructorParams;

        // Deploy contract using walletClient
        const hash = await walletClient.deployContract({
          abi: SimpleTokenVaultABI,
          bytecode: params.bytecode,
          args: [owner, operator, token],
        });

        // Wait for confirmation
        setStatus('confirming');
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (!receipt.contractAddress) {
          throw new Error('Contract deployment failed: no contract address in receipt');
        }

        const deployResult: DeployVaultResult = {
          vaultAddress: receipt.contractAddress,
          deployTxHash: hash,
        };

        setResult(deployResult);
        setStatus('success');

        return deployResult;
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
    deploy,
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
