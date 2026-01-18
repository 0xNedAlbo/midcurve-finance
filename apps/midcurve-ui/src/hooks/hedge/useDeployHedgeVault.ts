/**
 * useDeployHedgeVault - Deploy HedgeVault contract from user's wallet
 *
 * Deploys the HedgeVault ERC-4626 contract with the NFT ID in the constructor.
 * The NFT is not transferred in the constructor - it's transferred later via init().
 *
 * Prerequisites:
 * - User must call init() after deployment to transfer the NFT
 * - NFT must be approved for transfer to the vault address before init()
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

export type DeployHedgeVaultStatus =
  | 'idle'
  | 'switching_chain'
  | 'awaiting_signature'
  | 'confirming'
  | 'success'
  | 'error';

export interface DeployHedgeVaultParams {
  /** Target chain ID for deployment */
  chainId: number;
  /** Compiled bytecode (0x prefixed) */
  bytecode: `0x${string}`;
  /** Constructor parameters */
  constructorParams: {
    /** Uniswap V3 NonfungiblePositionManager address */
    positionManager: Address;
    /** Paraswap AugustusRegistry address */
    augustusRegistry: Address;
    /** NFT token ID (stored in contract, transferred via init()) */
    nftId: bigint;
    /** Quote token address (ERC-4626 asset) */
    quoteToken: Address;
    /** Operator address for executing triggers */
    operator: Address;
    /** SIL trigger price (sqrtPriceX96) */
    silSqrtPriceX96: bigint;
    /** TIP trigger price (sqrtPriceX96) */
    tipSqrtPriceX96: bigint;
    /** Loss cap in basis points (e.g., 1000 = 10%) */
    lossCapBps: number;
    /** Blocks to wait before reopen (uint256) */
    reopenCooldownBlocks: bigint;
    /** Deposit mode: 0=CLOSED, 1=SEMI_PRIVATE, 2=PUBLIC */
    depositMode: number;
    /** Vault token name */
    vaultName: string;
    /** Vault token symbol */
    vaultSymbol: string;
  };
}

export interface DeployHedgeVaultResult {
  /** Deployed vault contract address */
  vaultAddress: Address;
  /** Deployment transaction hash */
  deployTxHash: Hash;
}

// HedgeVault constructor ABI matching HedgeVault.sol (lines 338-351)
// constructor(
//   address positionManager_,
//   address augustusRegistry_,
//   uint256 nftId_,
//   address quoteToken_,
//   address operator_,
//   uint160 silSqrtPriceX96_,
//   uint160 tipSqrtPriceX96_,
//   uint16 lossCapBps_,
//   uint256 reopenCooldownBlocks_,
//   DepositMode depositMode_,  // enum = uint8
//   string memory name_,
//   string memory symbol_
// )
const HEDGE_VAULT_ABI: Abi = [
  {
    type: 'constructor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'positionManager_', type: 'address' },
      { name: 'augustusRegistry_', type: 'address' },
      { name: 'nftId_', type: 'uint256' },
      { name: 'quoteToken_', type: 'address' },
      { name: 'operator_', type: 'address' },
      { name: 'silSqrtPriceX96_', type: 'uint160' },
      { name: 'tipSqrtPriceX96_', type: 'uint160' },
      { name: 'lossCapBps_', type: 'uint16' },
      { name: 'reopenCooldownBlocks_', type: 'uint256' },
      { name: 'depositMode_', type: 'uint8' },
      { name: 'name_', type: 'string' },
      { name: 'symbol_', type: 'string' },
    ],
  },
];

export function useDeployHedgeVault() {
  const { address: userAddress, isConnected } = useAccount();
  const currentChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [status, setStatus] = useState<DeployHedgeVaultStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<DeployHedgeVaultResult | null>(null);

  const deploy = useCallback(
    async (params: DeployHedgeVaultParams): Promise<DeployHedgeVaultResult> => {
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

        const {
          positionManager,
          augustusRegistry,
          nftId,
          quoteToken,
          operator,
          silSqrtPriceX96,
          tipSqrtPriceX96,
          lossCapBps,
          reopenCooldownBlocks,
          depositMode,
          vaultName,
          vaultSymbol,
        } = params.constructorParams;

        // Deploy contract using walletClient
        // Args order must match constructor ABI exactly
        const hash = await walletClient.deployContract({
          abi: HEDGE_VAULT_ABI,
          bytecode: params.bytecode,
          args: [
            positionManager,
            augustusRegistry,
            nftId,
            quoteToken,
            operator,
            silSqrtPriceX96,
            tipSqrtPriceX96,
            lossCapBps,
            reopenCooldownBlocks,
            depositMode,
            vaultName,
            vaultSymbol,
          ],
        });

        // Wait for confirmation
        setStatus('confirming');
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (!receipt.contractAddress) {
          throw new Error('Contract deployment failed: no contract address in receipt');
        }

        const deployResult: DeployHedgeVaultResult = {
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
