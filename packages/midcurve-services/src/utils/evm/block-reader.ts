/**
 * EVM Block Reader Utilities
 *
 * Low-level utilities for reading block data from EVM chains using viem PublicClient.
 * These are pure functions that take explicit dependencies for testability.
 */

import type { EvmConfig } from '../../config/evm.js';
import type { EvmBlockInfo } from '../../services/types/block/evm-block-info.js';

/**
 * Get block information by block number
 *
 * @param blockNumber - Block number to retrieve
 * @param chainId - Chain ID to query
 * @param evmConfig - EVM configuration instance
 * @returns Block information
 * @throws Error if chain is not supported or RPC call fails
 */
export async function getBlockByNumber(
  blockNumber: bigint,
  chainId: number,
  evmConfig: EvmConfig
): Promise<EvmBlockInfo> {
  const client = evmConfig.getPublicClient(chainId);
  const chainConfig = evmConfig.getChainConfig(chainId);

  try {
    const block = await client.getBlock({
      blockNumber,
      includeTransactions: false,
    });

    if (!block) {
      throw new Error(
        `Block not found: ${blockNumber} on ${chainConfig.name} (Chain ID: ${chainId})`
      );
    }

    return {
      hash: block.hash!,
      number: block.number!,
      timestamp: block.timestamp,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
      baseFeePerGas: block.baseFeePerGas ?? null,
      transactionCount: block.transactions.length,
      parentHash: block.parentHash,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to get block ${blockNumber} on ${chainConfig.name} (Chain ID: ${chainId}): ${error.message}`
      );
    }
    throw new Error(
      `Unknown error getting block ${blockNumber} on ${chainConfig.name} (Chain ID: ${chainId})`
    );
  }
}

/**
 * Get block information by block tag
 *
 * @param blockTag - Block tag to retrieve ("finalized", "safe", "latest")
 * @param chainId - Chain ID to query
 * @param evmConfig - EVM configuration instance
 * @returns Block information, or null if tag is not supported by the chain
 * @throws Error if chain is not supported or RPC call fails (excluding unsupported tag)
 */
export async function getBlockByTag(
  blockTag: 'finalized' | 'safe' | 'latest',
  chainId: number,
  evmConfig: EvmConfig
): Promise<EvmBlockInfo | null> {
  const client = evmConfig.getPublicClient(chainId);

  try {
    const block = await client.getBlock({
      blockTag,
      includeTransactions: false,
    });

    if (!block || !block.number) {
      return null;
    }

    return {
      hash: block.hash!,
      number: block.number,
      timestamp: block.timestamp,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
      baseFeePerGas: block.baseFeePerGas ?? null,
      transactionCount: block.transactions.length,
      parentHash: block.parentHash,
      blockTag,
    };
  } catch (error) {
    // Block tag not supported by chain (e.g., "finalized" on chains without this tag)
    // Return null instead of throwing to allow graceful fallback
    return null;
  }
}

/**
 * Get current (latest) block number
 *
 * @param chainId - Chain ID to query
 * @param evmConfig - EVM configuration instance
 * @returns Latest block number
 * @throws Error if chain is not supported or RPC call fails
 */
export async function getCurrentBlockNumber(
  chainId: number,
  evmConfig: EvmConfig
): Promise<bigint> {
  const client = evmConfig.getPublicClient(chainId);
  const chainConfig = evmConfig.getChainConfig(chainId);

  try {
    return await client.getBlockNumber();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to get current block number on ${chainConfig.name} (Chain ID: ${chainId}): ${error.message}`
      );
    }
    throw new Error(
      `Unknown error getting current block number on ${chainConfig.name} (Chain ID: ${chainId})`
    );
  }
}
