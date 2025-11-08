/**
 * EVM Block Service
 *
 * Service for querying block information and finality status from EVM chains.
 * Provides methods to determine if blocks are finalized using chain-specific configuration.
 */

import type { EvmConfig } from '../../config/evm.js';
import { getEvmConfig } from '../../config/evm.js';
import type { EvmBlockInfo } from '../types/block/evm-block-info.js';
import {
  getBlockByNumber,
  getBlockByTag,
  getCurrentBlockNumber,
} from '../../utils/evm/block-reader.js';
import { createServiceLogger, log } from '../../logging/logger-factory.js';

/**
 * Dependencies for EvmBlockService
 * All dependencies are optional and will use defaults if not provided
 */
export interface EvmBlockServiceDependencies {
  /**
   * EVM configuration for chain RPC access and finality config
   * If not provided, the singleton EvmConfig instance will be used
   */
  evmConfig?: EvmConfig;
}

/**
 * EVM Block Service
 *
 * Provides block information queries and finality checks for EVM chains.
 */
export class EvmBlockService {
  private readonly evmConfig: EvmConfig;
  private readonly logger = createServiceLogger('EvmBlockService');

  /**
   * Creates a new EvmBlockService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
   */
  constructor(dependencies: EvmBlockServiceDependencies = {}) {
    this.evmConfig = dependencies.evmConfig ?? getEvmConfig();
  }

  /**
   * Get block information by block number
   *
   * @param blockNumber - Block number to retrieve
   * @param chainId - Chain ID to query
   * @returns Block information
   * @throws Error if chain is not supported or RPC call fails
   */
  async getBlockByNumber(
    blockNumber: bigint,
    chainId: number
  ): Promise<EvmBlockInfo> {
    log.methodEntry(this.logger, 'getBlockByNumber', {
      blockNumber: blockNumber.toString(),
      chainId,
    });

    try {
      const block = await getBlockByNumber(
        blockNumber,
        chainId,
        this.evmConfig
      );

      log.methodExit(this.logger, 'getBlockByNumber', {
        blockNumber: blockNumber.toString(),
        chainId,
        hash: block.hash,
      });

      return block;
    } catch (error) {
      log.methodError(this.logger, 'getBlockByNumber', error as Error, {
        blockNumber: blockNumber.toString(),
        chainId,
      });
      throw error;
    }
  }

  /**
   * Get block information by block tag
   *
   * @param blockTag - Block tag to retrieve ("finalized", "safe", "latest")
   * @param chainId - Chain ID to query
   * @returns Block information, or null if tag is not supported by the chain
   * @throws Error if chain is not supported or RPC call fails (excluding unsupported tag)
   */
  async getBlockByTag(
    blockTag: 'finalized' | 'safe' | 'latest',
    chainId: number
  ): Promise<EvmBlockInfo | null> {
    log.methodEntry(this.logger, 'getBlockByTag', { blockTag, chainId });

    try {
      const block = await getBlockByTag(blockTag, chainId, this.evmConfig);

      if (block) {
        log.methodExit(this.logger, 'getBlockByTag', {
          blockTag,
          chainId,
          blockNumber: block.number.toString(),
          hash: block.hash,
        });
      } else {
        this.logger.info({ blockTag, chainId }, 'Block tag not supported');
      }

      return block;
    } catch (error) {
      log.methodError(this.logger, 'getBlockByTag', error as Error, {
        blockTag,
        chainId,
      });
      throw error;
    }
  }

  /**
   * Get current (latest) block number
   *
   * @param chainId - Chain ID to query
   * @returns Current block number
   * @throws Error if chain is not supported or RPC call fails
   */
  async getCurrentBlockNumber(chainId: number): Promise<bigint> {
    log.methodEntry(this.logger, 'getCurrentBlockNumber', { chainId });

    try {
      const blockNumber = await getCurrentBlockNumber(chainId, this.evmConfig);

      log.methodExit(this.logger, 'getCurrentBlockNumber', {
        chainId,
        blockNumber: blockNumber.toString(),
      });

      return blockNumber;
    } catch (error) {
      log.methodError(this.logger, 'getCurrentBlockNumber', error as Error, {
        chainId,
      });
      throw error;
    }
  }

  /**
   * Get the last finalized block number for a chain
   *
   * Uses chain-specific finality configuration:
   * - blockTag: Uses native "finalized" block tag from RPC
   * - blockHeight: Subtracts minimum block height from latest block
   *
   * @param chainId - Chain ID to query
   * @returns Last finalized block number, or null if finalization cannot be determined
   * @throws Error if chain is not supported or RPC call fails
   */
  async getLastFinalizedBlockNumber(chainId: number): Promise<bigint | null> {
    log.methodEntry(this.logger, 'getLastFinalizedBlockNumber', { chainId });

    try {
      const finalityConfig = this.evmConfig.getFinalityConfig(chainId);

      let finalizedBlockNumber: bigint | null = null;

      if (finalityConfig.type === 'blockTag') {
        // Use native "finalized" block tag
        const finalizedBlock = await getBlockByTag(
          'finalized',
          chainId,
          this.evmConfig
        );
        finalizedBlockNumber = finalizedBlock?.number ?? null;
      } else if (finalityConfig.type === 'blockHeight') {
        // Fallback: subtract minBlockHeight from latest block
        const latestBlockNumber = await getCurrentBlockNumber(
          chainId,
          this.evmConfig
        );

        if (latestBlockNumber !== null) {
          const calculated =
            latestBlockNumber - BigInt(finalityConfig.minBlockHeight);
          finalizedBlockNumber = calculated >= 0n ? calculated : null;
        }
      }

      if (finalizedBlockNumber !== null) {
        log.methodExit(this.logger, 'getLastFinalizedBlockNumber', {
          chainId,
          finalizedBlockNumber: finalizedBlockNumber.toString(),
          finalityType: finalityConfig.type,
        });
      } else {
        this.logger.info(
          { chainId, finalityType: finalityConfig.type },
          'No finalized block available'
        );
      }

      return finalizedBlockNumber;
    } catch (error) {
      log.methodError(this.logger, 'getLastFinalizedBlockNumber', error as Error, {
        chainId,
      });
      throw error;
    }
  }

  /**
   * Check if a specific block is finalized
   *
   * Compares the given block number against the last finalized block.
   *
   * @param blockNumber - Block number to check
   * @param chainId - Chain ID to query
   * @returns true if the block is finalized, false otherwise
   * @throws Error if chain is not supported or RPC call fails
   */
  async isBlockFinalized(
    blockNumber: bigint,
    chainId: number
  ): Promise<boolean> {
    log.methodEntry(this.logger, 'isBlockFinalized', {
      blockNumber: blockNumber.toString(),
      chainId,
    });

    try {
      const finalizedBlockNumber = await this.getLastFinalizedBlockNumber(
        chainId
      );

      if (finalizedBlockNumber === null) {
        this.logger.info(
          { blockNumber: blockNumber.toString(), chainId },
          'Cannot determine finality (no finalized block)'
        );
        return false;
      }

      const isFinalized = blockNumber <= finalizedBlockNumber;

      log.methodExit(this.logger, 'isBlockFinalized', {
        blockNumber: blockNumber.toString(),
        chainId,
        finalizedBlockNumber: finalizedBlockNumber.toString(),
        isFinalized,
      });

      return isFinalized;
    } catch (error) {
      log.methodError(this.logger, 'isBlockFinalized', error as Error, {
        blockNumber: blockNumber.toString(),
        chainId,
      });
      throw error;
    }
  }
}
