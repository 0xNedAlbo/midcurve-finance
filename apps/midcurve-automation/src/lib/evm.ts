/**
 * EVM Client Utilities
 *
 * Provides viem public clients for reading pool prices and broadcasting transactions.
 */

import { createPublicClient, http, type PublicClient, type Chain } from 'viem';
import { mainnet, arbitrum, base, bsc, polygon, optimism } from 'viem/chains';
import type { SupportedChainId } from './config';

// Re-export for convenience
export type { SupportedChainId } from './config';

/**
 * Chain configurations with RPC URLs from environment
 */
const CHAIN_CONFIGS: Record<SupportedChainId, { chain: Chain; rpcEnvVar: string }> = {
  1: { chain: mainnet, rpcEnvVar: 'RPC_URL_ETHEREUM' },
  42161: { chain: arbitrum, rpcEnvVar: 'RPC_URL_ARBITRUM' },
  8453: { chain: base, rpcEnvVar: 'RPC_URL_BASE' },
  56: { chain: bsc, rpcEnvVar: 'RPC_URL_BSC' },
  137: { chain: polygon, rpcEnvVar: 'RPC_URL_POLYGON' },
  10: { chain: optimism, rpcEnvVar: 'RPC_URL_OPTIMISM' },
};

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
