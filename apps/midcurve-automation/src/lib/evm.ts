/**
 * EVM Client Utilities
 *
 * Provides viem public clients for reading pool prices and broadcasting transactions.
 */

import { createPublicClient, http, type PublicClient, type Chain } from 'viem';
import { mainnet, arbitrum, base, bsc, polygon, optimism, localhost } from 'viem/chains';
import type { SupportedChainId } from './config';

// Re-export for convenience
export type { SupportedChainId } from './config';

/**
 * Production chain configurations
 */
const PRODUCTION_CHAIN_CONFIGS: Record<number, { chain: Chain; rpcEnvVar: string }> = {
  1: { chain: mainnet, rpcEnvVar: 'RPC_URL_ETHEREUM' },
  42161: { chain: arbitrum, rpcEnvVar: 'RPC_URL_ARBITRUM' },
  8453: { chain: base, rpcEnvVar: 'RPC_URL_BASE' },
  56: { chain: bsc, rpcEnvVar: 'RPC_URL_BSC' },
  137: { chain: polygon, rpcEnvVar: 'RPC_URL_POLYGON' },
  10: { chain: optimism, rpcEnvVar: 'RPC_URL_OPTIMISM' },
};

/**
 * Local chain configuration (dev/test only)
 */
const LOCAL_CHAIN_CONFIGS: Record<number, { chain: Chain; rpcEnvVar: string }> = {
  31337: { chain: { ...localhost, id: 31337 }, rpcEnvVar: 'RPC_URL_LOCAL' },
};

/**
 * Chain configurations with RPC URLs from environment
 * Local chain is only included in non-production environments.
 */
const CHAIN_CONFIGS: Record<SupportedChainId, { chain: Chain; rpcEnvVar: string }> =
  process.env.NODE_ENV === 'production'
    ? (PRODUCTION_CHAIN_CONFIGS as Record<SupportedChainId, { chain: Chain; rpcEnvVar: string }>)
    : ({ ...PRODUCTION_CHAIN_CONFIGS, ...LOCAL_CHAIN_CONFIGS } as Record<
        SupportedChainId,
        { chain: Chain; rpcEnvVar: string }
      >);

/**
 * Cache for public clients (one per chain)
 */
const clientCache = new Map<SupportedChainId, PublicClient>();

/**
 * Get RPC URL for a chain from environment
 */
function getRpcUrl(chainId: SupportedChainId): string {
  const config = CHAIN_CONFIGS[chainId];
  const url = process.env[config.rpcEnvVar];

  if (!url) {
    throw new Error(`${config.rpcEnvVar} environment variable is required for chain ${chainId}`);
  }

  return url;
}

/**
 * Get a public client for a specific chain
 */
export function getPublicClient(chainId: SupportedChainId): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) {
    return cached;
  }

  const config = CHAIN_CONFIGS[chainId];
  const rpcUrl = getRpcUrl(chainId);

  const client = createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl),
  });

  clientCache.set(chainId, client);
  return client;
}

/**
 * UniswapV3 Pool ABI for slot0 read
 */
export const UNISWAP_V3_POOL_ABI = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Read current pool price (sqrtPriceX96)
 */
export async function readPoolPrice(
  chainId: SupportedChainId,
  poolAddress: `0x${string}`
): Promise<{ sqrtPriceX96: bigint; tick: number }> {
  const client = getPublicClient(chainId);

  const result = await client.readContract({
    address: poolAddress,
    abi: UNISWAP_V3_POOL_ABI,
    functionName: 'slot0',
  });

  return {
    sqrtPriceX96: result[0],
    tick: result[1],
  };
}

/**
 * Broadcast a signed transaction
 */
export async function broadcastTransaction(
  chainId: SupportedChainId,
  signedTx: `0x${string}`
): Promise<`0x${string}`> {
  const client = getPublicClient(chainId);
  const hash = await client.sendRawTransaction({ serializedTransaction: signedTx });
  return hash;
}

/**
 * Wait for transaction confirmation
 */
export async function waitForTransaction(
  chainId: SupportedChainId,
  txHash: `0x${string}`,
  confirmations = 1
): Promise<{
  blockNumber: bigint;
  gasUsed: bigint;
  status: 'success' | 'reverted';
}> {
  const client = getPublicClient(chainId);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations,
  });

  return {
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    status: receipt.status,
  };
}

/**
 * Get the revert reason for a failed transaction.
 *
 * Simulates the transaction at the block it was included to extract
 * the revert data, then decodes it to a human-readable message.
 *
 * @param chainId - Chain ID
 * @param txHash - Transaction hash
 * @returns Decoded revert reason, or null if unable to determine
 */
export async function getRevertReason(
  chainId: SupportedChainId,
  txHash: `0x${string}`
): Promise<string | null> {
  // Import here to avoid circular dependency
  const { decodeRevertReason } = await import('./error-decoder');
  const client = getPublicClient(chainId);

  try {
    // Get the original transaction
    const tx = await client.getTransaction({ hash: txHash });

    if (!tx) {
      return 'Transaction not found';
    }

    // Simulate the transaction at the block it was included
    // This will throw an error with the revert data
    await client.call({
      account: tx.from,
      to: tx.to,
      data: tx.input,
      value: tx.value,
      blockNumber: tx.blockNumber,
      gas: tx.gas,
    });

    // If call succeeded, something is unexpected
    return 'Transaction simulation succeeded (unexpected for reverted tx)';
  } catch (error) {
    // Extract revert data from error
    const err = error as Error & { data?: string; cause?: { data?: string } };

    // Try to get revert data from error
    let revertData = err.data || err.cause?.data;

    // Some RPC providers include the data in a different format
    if (!revertData && err.message) {
      // Try to extract hex data from error message
      const match = err.message.match(/0x[a-fA-F0-9]+/);
      if (match && match[0].length >= 10) {
        revertData = match[0];
      }
    }

    if (revertData) {
      return decodeRevertReason(revertData as `0x${string}`);
    }

    // Fallback to error message
    return err.message || 'Unknown revert reason';
  }
}

/**
 * Get the current on-chain nonce for an address.
 *
 * @param chainId - Chain ID
 * @param address - Wallet address
 * @returns Current nonce
 */
export async function getOnChainNonce(
  chainId: SupportedChainId,
  address: `0x${string}`
): Promise<number> {
  const client = getPublicClient(chainId);
  const nonce = await client.getTransactionCount({ address });
  return nonce;
}
