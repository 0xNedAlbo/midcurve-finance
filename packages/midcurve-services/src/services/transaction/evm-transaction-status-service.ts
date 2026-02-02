/**
 * EvmTransactionStatusService
 *
 * Service for checking EVM transaction status and receipt details.
 * Implements backend-first architecture: all RPC calls happen server-side.
 *
 * Features:
 * - Fetches transaction receipt via viem PublicClient (RPC)
 * - Calculates confirmations from current block number
 * - Handles pending and not-found transactions gracefully
 * - No caching (transaction status can change rapidly)
 */

import { normalizeAddress } from '@midcurve/shared';
import { EvmConfig } from '../../config/evm.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Transaction status values
 */
export type TransactionStatusValue = 'success' | 'reverted' | 'pending' | 'not_found';

/**
 * EVM transaction status data returned from service
 */
export interface EvmTransactionStatus {
  /** Transaction hash */
  txHash: string;
  /** Chain ID */
  chainId: number;
  /** Transaction status */
  status: TransactionStatusValue;
  /** Block number where transaction was included (if mined) */
  blockNumber?: bigint;
  /** Block hash where transaction was included (if mined) */
  blockHash?: string;
  /** Gas used by the transaction (if mined) */
  gasUsed?: bigint;
  /** Effective gas price paid (if mined) */
  effectiveGasPrice?: bigint;
  /** Number of block confirmations (if mined) */
  confirmations?: number;
  /** Number of logs emitted by the transaction (if mined) */
  logsCount?: number;
  /** Contract address if this was a contract creation (if applicable) */
  contractAddress?: string | null;
  /** Timestamp when data was fetched */
  timestamp: Date;
}

/**
 * Dependencies for EvmTransactionStatusService
 */
export interface EvmTransactionStatusServiceDependencies {
  /**
   * EVM configuration for chain RPC access
   * If not provided, the singleton EvmConfig instance will be used
   */
  evmConfig?: EvmConfig;
}

/**
 * Service for checking EVM transaction status
 */
export class EvmTransactionStatusService {
  private readonly evmConfig: EvmConfig;
  private readonly logger: ServiceLogger = createServiceLogger('EvmTransactionStatusService');

  constructor(dependencies: EvmTransactionStatusServiceDependencies = {}) {
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
  }

  /**
   * Get transaction status and receipt details
   *
   * @param txHash - Transaction hash (0x-prefixed)
   * @param chainId - EVM chain ID
   * @returns Transaction status and receipt details
   *
   * @throws Error if txHash format is invalid
   * @throws Error if chain is not supported
   * @throws Error if RPC call fails
   *
   * @example
   * ```typescript
   * const service = new EvmTransactionStatusService();
   * const status = await service.getStatus(
   *   '0x1234567890abcdef...',
   *   1 // Ethereum mainnet
   * );
   *
   * if (status.status === 'success') {
   *   console.log(`Confirmed with ${status.confirmations} confirmations`);
   *   console.log(`Gas used: ${status.gasUsed}`);
   * } else if (status.status === 'pending') {
   *   console.log('Transaction is still pending');
   * } else if (status.status === 'reverted') {
   *   console.log('Transaction reverted');
   * } else {
   *   console.log('Transaction not found');
   * }
   * ```
   */
  async getStatus(txHash: string, chainId: number): Promise<EvmTransactionStatus> {
    // 1. Validate transaction hash format
    if (!this.isValidTxHash(txHash)) {
      throw new Error(`Invalid transaction hash format: ${txHash}`);
    }

    // Normalize to lowercase for consistency
    const normalizedHash = txHash.toLowerCase() as `0x${string}`;

    log.externalApiCall(this.logger, 'EVM RPC', 'getTransactionReceipt', {
      txHash: normalizedHash,
      chainId,
    });

    try {
      const client = this.evmConfig.getPublicClient(chainId);

      // Fetch receipt and current block number in parallel
      const [receipt, currentBlockNumber] = await Promise.all([
        client.getTransactionReceipt({ hash: normalizedHash }).catch(() => null),
        client.getBlockNumber(),
      ]);

      // Transaction not found (never submitted or dropped from mempool)
      if (!receipt) {
        // Check if transaction is pending by trying to get it
        const tx = await client.getTransaction({ hash: normalizedHash }).catch(() => null);

        if (tx) {
          // Transaction exists but no receipt = pending
          this.logger.debug(
            { txHash: normalizedHash, chainId },
            'Transaction is pending (no receipt yet)'
          );

          return {
            txHash: normalizedHash,
            chainId,
            status: 'pending',
            timestamp: new Date(),
          };
        }

        // Transaction doesn't exist at all
        this.logger.debug(
          { txHash: normalizedHash, chainId },
          'Transaction not found'
        );

        return {
          txHash: normalizedHash,
          chainId,
          status: 'not_found',
          timestamp: new Date(),
        };
      }

      // Calculate confirmations
      const confirmations = Number(currentBlockNumber - receipt.blockNumber) + 1;

      // Determine status from receipt
      const status: TransactionStatusValue = receipt.status === 'success' ? 'success' : 'reverted';

      this.logger.debug(
        {
          txHash: normalizedHash,
          chainId,
          status,
          blockNumber: receipt.blockNumber.toString(),
          confirmations,
          gasUsed: receipt.gasUsed.toString(),
        },
        'Successfully fetched transaction status'
      );

      return {
        txHash: normalizedHash,
        chainId,
        status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        confirmations,
        logsCount: receipt.logs.length,
        contractAddress: receipt.contractAddress
          ? normalizeAddress(receipt.contractAddress)
          : null,
        timestamp: new Date(),
      };
    } catch (error) {
      log.methodError(
        this.logger,
        'getStatus',
        error as Error,
        {
          txHash: normalizedHash,
          chainId,
        }
      );

      throw new Error(
        `Failed to fetch transaction status: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Validate transaction hash format
   *
   * @private
   */
  private isValidTxHash(txHash: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(txHash);
  }
}
