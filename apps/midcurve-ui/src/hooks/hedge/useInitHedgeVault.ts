/**
 * useInitHedgeVault - Initialize HedgeVault with NFT position
 *
 * Calls the init() function on a deployed HedgeVault contract
 * to transfer the Uniswap V3 position NFT into the vault.
 * The NFT ID is stored in the contract at deployment time.
 *
 * Prerequisites:
 * - Vault must be deployed with nftId in constructor
 * - NFT must be approved for transfer to the vault address
 */

import { useCallback, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useChainId,
  useSwitchChain,
} from 'wagmi';
import type { Hash, Address, Abi } from 'viem';

export type InitHedgeVaultStatus =
  | 'idle'
  | 'switching_chain'
  | 'awaiting_signature'
  | 'confirming'
  | 'success'
  | 'error';

export interface InitHedgeVaultParams {
  /** Target chain ID */
  chainId: number;
  /** Deployed vault address */
  vaultAddress: Address;
}

export interface InitHedgeVaultResult {
  /** Transaction hash */
  txHash: Hash;
}

// ABI for init function (nftId is stored in constructor, not passed to init)
const HEDGE_VAULT_INIT_ABI: Abi = [
  {
    type: 'function',
    name: 'init',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
];

export function useInitHedgeVault() {
  const { address: userAddress, isConnected } = useAccount();
  const currentChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [status, setStatus] = useState<InitHedgeVaultStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<InitHedgeVaultResult | null>(null);

  const init = useCallback(
    async (params: InitHedgeVaultParams): Promise<InitHedgeVaultResult> => {
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

        // Request user signature
        setStatus('awaiting_signature');

        const hash = await walletClient.writeContract({
          address: params.vaultAddress,
          abi: HEDGE_VAULT_INIT_ABI,
          functionName: 'init',
          args: [],
          chain: null,
          account: userAddress,
        });

        // Wait for confirmation
        setStatus('confirming');
        await publicClient.waitForTransactionReceipt({ hash });

        const initResult: InitHedgeVaultResult = {
          txHash: hash,
        };

        setResult(initResult);
        setStatus('success');

        return initResult;
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
    init,
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
