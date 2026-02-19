/**
 * EvmTxStatusSubscriber Worker
 *
 * Monitors EVM transaction status using RPC polling (not WebSocket).
 * Transaction receipts aren't available via eth_subscribe, so we poll.
 *
 * Lifecycle:
 * - active: polling RPC for transaction status
 * - paused: stops polling after 60s without client polling
 * - deleted: cleaned up after 5min in paused state OR 5min after completion
 *
 * Tracks confirmations and marks subscription as complete when
 * targetConfirmations is reached.
 */

import { prisma, Prisma } from '@midcurve/database';
import { onchainDataLogger, priceLog } from '../lib/logger.js';
import { isSupportedChain, type SupportedChainId } from '../lib/config.js';
import type {
  EvmTxStatusSubscriptionConfig,
  EvmTxStatusSubscriptionState,
  TxStatusValue,
} from '@midcurve/shared';
import { getEvmConfig } from '@midcurve/services';
import { type PublicClient, type Hash } from 'viem';

const log = onchainDataLogger.child({ component: 'EvmTxStatusSubscriber' });

/** Interval for polling transaction status (default: 3 seconds) */
const POLL_INTERVAL_MS = parseInt(process.env.TX_STATUS_POLL_INTERVAL_MS || '3000', 10);

/** Threshold for pausing subscriptions (default: 60 seconds) */
const PAUSE_THRESHOLD_MS = parseInt(process.env.TX_STATUS_STALE_THRESHOLD_MS || '60000', 10);

/** Threshold for auto-deleting completed subscriptions (default: 5 minutes) */
const COMPLETED_RETENTION_MS = parseInt(process.env.TX_STATUS_COMPLETED_RETENTION_MS || '300000', 10);

/** Threshold for deleting paused subscriptions (default: 5 minutes) */
const PRUNE_THRESHOLD_MS = parseInt(process.env.TX_STATUS_PRUNE_THRESHOLD_MS || '300000', 10);

/** Interval for cleanup operations (default: 30 seconds) */
const CLEANUP_INTERVAL_MS = parseInt(process.env.TX_STATUS_CLEANUP_INTERVAL_MS || '30000', 10);

/** Interval for polling database for new subscriptions (default: 5 seconds) */
const DB_POLL_INTERVAL_MS = parseInt(process.env.TX_STATUS_DB_POLL_INTERVAL_MS || '5000', 10);

/**
 * Transaction subscription info for internal tracking.
 */
interface TxSubscriptionInfo {
  id: string;
  subscriptionId: string;
  chainId: SupportedChainId;
  txHash: string;
  targetConfirmations: number;
}

/**
 * EvmTxStatusSubscriber monitors transaction status using RPC polling.
 */
export class EvmTxStatusSubscriber {
  private isRunning = false;

  // Track subscribed transactions by subscriptionId
  private subscribedTxs: Map<string, TxSubscriptionInfo> = new Map();

  // RPC clients per chain (HTTP only, no WebSocket needed)
  private clients: Map<SupportedChainId, PublicClient> = new Map();

  // Timers
  private pollTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private dbPollTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'EvmTxStatusSubscriber', 'starting');

    try {
      // Initialize RPC clients for all supported chains
      this.initializeClients();

      // Load active subscriptions from database
      await this.loadActiveSubscriptions();

      this.isRunning = true;

      // Start polling for transaction status
      this.startPolling();

      // Start polling database for new subscriptions
      this.startDbPolling();

      // Start cleanup timer
      this.startCleanup();

      priceLog.workerLifecycle(log, 'EvmTxStatusSubscriber', 'started', {
        subscriptionCount: this.subscribedTxs.size,
        clientCount: this.clients.size,
      });
    } catch (error) {
      priceLog.workerLifecycle(log, 'EvmTxStatusSubscriber', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the subscriber.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'Subscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'EvmTxStatusSubscriber', 'stopping');

    // Stop timers
    this.stopPolling();
    this.stopDbPolling();
    this.stopCleanup();

    // Clear state
    this.subscribedTxs.clear();
    this.clients.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'EvmTxStatusSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    subscriptionCount: number;
    clientCount: number;
    subscriptionsByChain: Record<number, number>;
  } {
    const subscriptionsByChain: Record<number, number> = {};
    for (const tx of this.subscribedTxs.values()) {
      subscriptionsByChain[tx.chainId] = (subscriptionsByChain[tx.chainId] || 0) + 1;
    }

    return {
      isRunning: this.isRunning,
      subscriptionCount: this.subscribedTxs.size,
      clientCount: this.clients.size,
      subscriptionsByChain,
    };
  }

  /**
   * Initialize HTTP clients for all supported chains.
   */
  private initializeClients(): void {
    const evmConfig = getEvmConfig();
    const supportedChains: SupportedChainId[] = [1, 42161, 8453, 56, 137, 10, 31337];

    for (const chainId of supportedChains) {
      try {
        // Use the configured public client from EvmConfig
        const client = evmConfig.getPublicClient(chainId);
        this.clients.set(chainId, client);
        log.info({ chainId, msg: 'Initialized RPC client' });
      } catch (error) {
        // Chain not configured, skip
        log.debug({
          chainId,
          msg: 'Chain not configured, skipping',
        });
      }
    }
  }

  /**
   * Load active subscriptions from database.
   */
  private async loadActiveSubscriptions(): Promise<void> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'evm-tx-status',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
        state: true,
      },
    });

    log.info({ count: subscriptions.length, msg: 'Loaded active tx status subscriptions' });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as EvmTxStatusSubscriptionConfig;
      const state = sub.state as unknown as EvmTxStatusSubscriptionState;

      // Skip completed subscriptions
      if (state.isComplete) {
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID' });
        continue;
      }

      const chainId = config.chainId as SupportedChainId;

      this.subscribedTxs.set(sub.subscriptionId, {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        chainId,
        txHash: config.txHash,
        targetConfirmations: config.targetConfirmations,
      });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');
  }

  // ===========================================================================
  // RPC Polling (for transaction status)
  // ===========================================================================

  /**
   * Start polling for transaction status.
   */
  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.pollTransactions().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling transactions',
        });
      });
    }, POLL_INTERVAL_MS);

    log.info({ intervalMs: POLL_INTERVAL_MS, msg: 'Started transaction polling' });
  }

  /**
   * Stop transaction polling.
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      log.info({ msg: 'Stopped transaction polling' });
    }
  }

  /**
   * Poll all active transactions for status updates.
   */
  private async pollTransactions(): Promise<void> {
    if (this.subscribedTxs.size === 0) {
      return;
    }

    // Group subscriptions by chain for efficient batching
    const byChain = new Map<SupportedChainId, TxSubscriptionInfo[]>();
    for (const tx of this.subscribedTxs.values()) {
      const chain = byChain.get(tx.chainId) || [];
      chain.push(tx);
      byChain.set(tx.chainId, chain);
    }

    // Poll each chain
    for (const [chainId, txs] of byChain) {
      const client = this.clients.get(chainId);
      if (!client) {
        log.warn({ chainId, msg: 'No client for chain, skipping' });
        continue;
      }

      // Get current block number for confirmations calculation
      let currentBlock: bigint;
      try {
        currentBlock = await client.getBlockNumber();
      } catch (error) {
        log.error({
          chainId,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Failed to get current block number',
        });
        continue;
      }

      // Check each transaction
      for (const tx of txs) {
        try {
          await this.checkTransactionStatus(client, tx, currentBlock);
        } catch (error) {
          log.error({
            chainId,
            txHash: tx.txHash,
            subscriptionId: tx.subscriptionId,
            error: error instanceof Error ? error.message : String(error),
            msg: 'Failed to check transaction status',
          });
        }
      }
    }
  }

  /**
   * Check and update status for a single transaction.
   */
  private async checkTransactionStatus(
    client: PublicClient,
    tx: TxSubscriptionInfo,
    currentBlock: bigint
  ): Promise<void> {
    const now = new Date();

    // Try to get transaction receipt
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({
        hash: tx.txHash as Hash,
      });
    } catch {
      // Receipt not found - transaction might be pending or not found
      receipt = null;
    }

    // Get current state from database
    const subscription = await prisma.onchainDataSubscribers.findUnique({
      where: { id: tx.id },
    });

    if (!subscription || subscription.status === 'deleted') {
      // Remove from tracking
      this.subscribedTxs.delete(tx.subscriptionId);
      return;
    }

    let status: TxStatusValue;
    let blockNumber: bigint | null = null;
    let blockHash: string | null = null;
    let confirmations = 0;
    let gasUsed: bigint | null = null;
    let effectiveGasPrice: bigint | null = null;
    let logsCount: number | null = null;
    let contractAddress: string | null = null;
    let isComplete = false;

    if (!receipt) {
      // Check if transaction exists but is not yet mined
      try {
        const txData = await client.getTransaction({
          hash: tx.txHash as Hash,
        });

        if (txData) {
          status = 'pending';
        } else {
          status = 'not_found';
        }
      } catch {
        status = 'not_found';
      }
    } else {
      // Transaction has been mined
      blockNumber = receipt.blockNumber;
      blockHash = receipt.blockHash;
      gasUsed = receipt.gasUsed;
      effectiveGasPrice = receipt.effectiveGasPrice ?? null;
      logsCount = receipt.logs.length;
      contractAddress = receipt.contractAddress ?? null;

      // Calculate confirmations
      if (blockNumber) {
        confirmations = Number(currentBlock - blockNumber) + 1;
      }

      // Determine status from receipt
      if (receipt.status === 'success') {
        status = 'success';
      } else {
        status = 'reverted';
      }

      // Check if complete (enough confirmations)
      // At this point, status is 'success' or 'reverted' (mined transaction)
      if (confirmations >= tx.targetConfirmations) {
        isComplete = true;
      }
    }

    // Build new state
    const newState: EvmTxStatusSubscriptionState = {
      status,
      blockNumber: blockNumber ? Number(blockNumber) : null,
      blockHash,
      confirmations,
      gasUsed: gasUsed?.toString() ?? null,
      effectiveGasPrice: effectiveGasPrice?.toString() ?? null,
      logsCount,
      contractAddress,
      lastCheckedAt: now.toISOString(),
      isComplete,
      completedAt: isComplete ? now.toISOString() : null,
    };

    // Update database
    await prisma.onchainDataSubscribers.update({
      where: { id: tx.id },
      data: {
        state: newState as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    // If complete, remove from active tracking (cleanup will delete it later)
    if (isComplete) {
      this.subscribedTxs.delete(tx.subscriptionId);
      log.info({
        chainId: tx.chainId,
        txHash: tx.txHash,
        subscriptionId: tx.subscriptionId,
        status,
        confirmations,
        msg: 'Transaction tracking complete',
      });
    } else if (status !== 'pending' && status !== 'not_found') {
      log.debug({
        chainId: tx.chainId,
        txHash: tx.txHash,
        status,
        confirmations,
        targetConfirmations: tx.targetConfirmations,
        msg: 'Transaction status update',
      });
    }
  }

  // ===========================================================================
  // Database Polling (for new subscriptions)
  // ===========================================================================

  /**
   * Start polling database for new subscriptions.
   */
  private startDbPolling(): void {
    this.dbPollTimer = setInterval(() => {
      this.pollNewSubscriptions().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling for new subscriptions',
        });
      });
    }, DB_POLL_INTERVAL_MS);

    log.info({ intervalMs: DB_POLL_INTERVAL_MS, msg: 'Started database polling' });
  }

  /**
   * Stop database polling.
   */
  private stopDbPolling(): void {
    if (this.dbPollTimer) {
      clearInterval(this.dbPollTimer);
      this.dbPollTimer = null;
      log.info({ msg: 'Stopped database polling' });
    }
  }

  /**
   * Poll database for new active subscriptions.
   */
  private async pollNewSubscriptions(): Promise<void> {
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'evm-tx-status',
        status: 'active',
        subscriptionId: {
          notIn: Array.from(this.subscribedTxs.keys()),
        },
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
        state: true,
      },
    });

    if (subscriptions.length === 0) {
      return;
    }

    log.info({ count: subscriptions.length, msg: 'Found new tx status subscriptions' });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as EvmTxStatusSubscriptionConfig;
      const state = sub.state as unknown as EvmTxStatusSubscriptionState;

      // Skip completed subscriptions
      if (state.isComplete) {
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        continue;
      }

      const chainId = config.chainId as SupportedChainId;

      this.subscribedTxs.set(sub.subscriptionId, {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        chainId,
        txHash: config.txHash,
        targetConfirmations: config.targetConfirmations,
      });

      log.info({
        chainId,
        txHash: config.txHash,
        subscriptionId: sub.subscriptionId,
        msg: 'Added new tx status subscription',
      });
    }
  }

  // ===========================================================================
  // Cleanup (pause stale, prune completed and paused)
  // ===========================================================================

  /**
   * Start the cleanup timer.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      Promise.all([
        this.pauseStaleSubscriptions(),
        this.pruneCompletedSubscriptions(),
        this.prunePausedSubscriptions(),
      ]).catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error during cleanup',
        });
      });
    }, CLEANUP_INTERVAL_MS);

    log.info({
      intervalMs: CLEANUP_INTERVAL_MS,
      pauseThresholdMs: PAUSE_THRESHOLD_MS,
      completedRetentionMs: COMPLETED_RETENTION_MS,
      pruneThresholdMs: PRUNE_THRESHOLD_MS,
      msg: 'Started cleanup timer',
    });
  }

  /**
   * Stop the cleanup timer.
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      log.info({ msg: 'Stopped cleanup timer' });
    }
  }

  /**
   * Pause subscriptions that haven't been polled by the client.
   */
  private async pauseStaleSubscriptions(): Promise<void> {
    // Find active subscriptions that have an expiry (persistent subscriptions with null expiresAfterMs are skipped)
    const candidates = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'evm-tx-status',
        status: 'active',
        expiresAfterMs: { not: null },
      },
      select: {
        id: true,
        subscriptionId: true,
        lastPolledAt: true,
        expiresAfterMs: true,
        state: true,
      },
    });

    const now = Date.now();
    const staleSubscriptions = candidates.filter((sub) => {
      if (!sub.lastPolledAt || sub.expiresAfterMs == null) return false;
      // Don't pause completed subscriptions (they'll be cleaned up separately)
      const state = sub.state as unknown as EvmTxStatusSubscriptionState;
      if (state.isComplete) return false;
      return now - sub.lastPolledAt.getTime() > sub.expiresAfterMs;
    });

    if (staleSubscriptions.length === 0) {
      return;
    }

    const pausedAt = new Date();

    for (const sub of staleSubscriptions) {
      await prisma.onchainDataSubscribers.update({
        where: { id: sub.id },
        data: {
          status: 'paused',
          pausedAt,
        },
      });

      // Remove from tracking
      this.subscribedTxs.delete(sub.subscriptionId);

      log.info({ subscriptionId: sub.subscriptionId, msg: 'Paused stale tx status subscription' });
    }
  }

  /**
   * Delete completed subscriptions after retention period.
   */
  private async pruneCompletedSubscriptions(): Promise<void> {
    const cutoffTime = new Date(Date.now() - COMPLETED_RETENTION_MS);

    // Find completed subscriptions that are past retention
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'evm-tx-status',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        state: true,
      },
    });

    const toDelete: string[] = [];
    for (const sub of subscriptions) {
      const state = sub.state as unknown as EvmTxStatusSubscriptionState;
      if (state.isComplete && state.completedAt) {
        const completedAt = new Date(state.completedAt);
        if (completedAt < cutoffTime) {
          toDelete.push(sub.subscriptionId);
        }
      }
    }

    if (toDelete.length === 0) {
      return;
    }

    await prisma.onchainDataSubscribers.deleteMany({
      where: {
        subscriptionId: { in: toDelete },
      },
    });

    log.info({ count: toDelete.length, msg: 'Pruned completed tx status subscriptions' });
  }

  /**
   * Delete paused subscriptions after prune threshold.
   */
  private async prunePausedSubscriptions(): Promise<void> {
    const cutoffTime = new Date(Date.now() - PRUNE_THRESHOLD_MS);

    const toDelete = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'evm-tx-status',
        status: 'paused',
        pausedAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        subscriptionId: true,
      },
    });

    if (toDelete.length === 0) {
      return;
    }

    const subscriptionIds = toDelete.map((sub) => sub.subscriptionId);

    await prisma.onchainDataSubscribers.deleteMany({
      where: {
        subscriptionId: { in: subscriptionIds },
      },
    });

    log.info({ count: toDelete.length, msg: 'Pruned paused tx status subscriptions' });
  }
}
