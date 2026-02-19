/**
 * Erc20BalanceSubscriber Worker
 *
 * Manages WebSocket subscriptions for ERC-20 token balance (Transfer) events.
 * Polls the database for active subscriptions and manages their lifecycle:
 * - active: subscribed to WebSocket events
 * - paused: removed from WebSocket after 60s without polling
 * - deleted: cleaned up after 5min in paused state
 *
 * API endpoint handles reactivation when a paused subscription is polled.
 */

import { prisma } from '@midcurve/database';
import { onchainDataLogger, priceLog } from '../lib/logger.js';
import {
  getConfiguredWssUrls,
  getWssUrl,
  getWorkerConfig,
  isSupportedChain,
  type SupportedChainId,
} from '../lib/config.js';
import {
  Erc20BalanceSubscriptionBatch,
  createBalanceSubscriptionBatches,
  type BalanceInfo,
} from '../ws/providers/erc20-balance.js';
import type { Erc20BalanceSubscriptionConfig } from '@midcurve/shared';

const log = onchainDataLogger.child({ component: 'Erc20BalanceSubscriber' });

/** Threshold for pausing subscriptions (default: 60 seconds) */
const PAUSE_THRESHOLD_MS = parseInt(process.env.BALANCE_STALE_THRESHOLD_MS || '60000', 10);

/** Threshold for deleting paused subscriptions (default: 5 minutes) */
const PRUNE_THRESHOLD_MS = parseInt(process.env.BALANCE_PRUNE_THRESHOLD_MS || '300000', 10);

/** Interval for checking stale subscriptions (default: 30 seconds) */
const CLEANUP_INTERVAL_MS = parseInt(process.env.BALANCE_CLEANUP_INTERVAL_MS || '30000', 10);

/** Interval for polling new subscriptions (default: 5 seconds) */
const POLL_INTERVAL_MS = parseInt(process.env.BALANCE_POLL_INTERVAL_MS || '5000', 10);

/**
 * Erc20BalanceSubscriber manages WebSocket subscriptions for Transfer events.
 * Subscriptions are created via the API and managed by this worker.
 */
export class Erc20BalanceSubscriber {
  private batches: Erc20BalanceSubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, Erc20BalanceSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Track subscribed balances by subscriptionId
  private subscribedBalances: Map<string, BalanceInfo & { chainId: SupportedChainId }> = new Map();

  // Timers
  private cleanupTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads active subscriptions and creates WebSocket batches.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'starting');

    try {
      // Load active subscriptions from database
      const balancesByChain = await this.loadActiveSubscriptions();

      // Get configured WSS URLs
      const wssConfigs = getConfiguredWssUrls();

      if (wssConfigs.length === 0) {
        log.warn({
          msg: 'No WS_RPC_URL_* environment variables configured, subscriber will not start. Set WS_RPC_URL_ETHEREUM, WS_RPC_URL_ARBITRUM, etc.',
        });
        return;
      }

      // Create subscription batches for each configured chain
      for (const wssConfig of wssConfigs) {
        const chainId = wssConfig.chainId as SupportedChainId;
        const balances = balancesByChain.get(chainId);

        if (!balances || balances.length === 0) {
          log.info({ chainId, msg: 'No active balance subscriptions for chain, skipping' });
          continue;
        }

        const chainBatches = createBalanceSubscriptionBatches(chainId, wssConfig.url, balances);
        this.batches.push(...chainBatches);
        this.batchesByChain.set(chainId, chainBatches);
      }

      this.isRunning = true;

      if (this.batches.length === 0) {
        log.info({ msg: 'No subscription batches created, subscriber will idle until new subscriptions are added' });
      } else {
        // Start all batches
        await Promise.all(this.batches.map((batch) => batch.start()));
      }

      // Start cleanup timer (pause stale, prune deleted)
      this.startCleanup();

      // Start polling for new subscriptions
      this.startPolling();

      const totalBalances = this.batches.reduce(
        (sum, batch) => sum + batch.getStatus().subscriptionCount,
        0
      );

      priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'started', {
        batchCount: this.batches.length,
        totalBalances,
      });
    } catch (error) {
      priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the subscriber.
   * Stops all WebSocket batches gracefully.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'Subscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'stopping');

    // Stop timers
    this.stopCleanup();
    this.stopPolling();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.subscribedBalances.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    batchCount: number;
    totalSubscriptions: number;
    batches: Array<{
      chainId: number;
      batchIndex: number;
      tokenCount: number;
      subscriptionCount: number;
      isConnected: boolean;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      batchCount: this.batches.length,
      totalSubscriptions: this.subscribedBalances.size,
      batches: this.batches.map((batch) => batch.getStatus()),
    };
  }

  /**
   * Load active subscriptions from database.
   * Groups by chain ID for batch creation.
   */
  private async loadActiveSubscriptions(): Promise<Map<SupportedChainId, BalanceInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    // Query active erc20-balance subscriptions
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
      },
    });

    log.info({ subscriptionCount: subscriptions.length, msg: 'Loaded active balance subscriptions' });

    // Group by chain ID
    const balancesByChain = new Map<SupportedChainId, BalanceInfo[]>();

    for (const sub of subscriptions) {
      const config = sub.config as unknown as Erc20BalanceSubscriptionConfig;

      if (!config.chainId || !config.tokenAddress) {
        log.warn({ subscriptionId: sub.subscriptionId, msg: 'Subscription config missing chainId or tokenAddress' });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID' });
        continue;
      }

      const chainId = config.chainId as SupportedChainId;
      const normalizedToken = config.tokenAddress.toLowerCase();
      const normalizedWallet = config.walletAddress.toLowerCase();

      const balanceInfo: BalanceInfo = {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        tokenAddress: normalizedToken,
        walletAddress: normalizedWallet,
      };

      // Track in internal state
      this.subscribedBalances.set(sub.subscriptionId, {
        ...balanceInfo,
        chainId,
      });

      // Add to chain grouping
      if (!balancesByChain.has(chainId)) {
        balancesByChain.set(chainId, []);
      }

      balancesByChain.get(chainId)!.push(balanceInfo);
    }

    // Log summary
    for (const [chainId, chainBalances] of balancesByChain) {
      log.info({ chainId, balanceCount: chainBalances.length, msg: 'Balances grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');

    return balancesByChain;
  }

  // ===========================================================================
  // Subscription Lifecycle Management
  // ===========================================================================

  /**
   * Add a balance subscription to the worker.
   * Called when API creates a new subscription or reactivates a paused one.
   */
  async addBalance(
    subscriptionId: string,
    id: string,
    chainId: number,
    tokenAddress: string,
    walletAddress: string
  ): Promise<void> {
    // Validate chain
    if (!isSupportedChain(chainId)) {
      log.warn({ chainId, subscriptionId, msg: 'Unsupported chain ID, cannot add balance' });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;

    // Check if already subscribed
    if (this.subscribedBalances.has(subscriptionId)) {
      log.debug({ subscriptionId, msg: 'Balance already subscribed' });
      return;
    }

    // Get WSS URL
    const wssUrl = getWssUrl(supportedChainId);
    if (!wssUrl) {
      log.warn({ chainId, subscriptionId, msg: 'No WSS URL configured for chain' });
      return;
    }

    const balanceInfo: BalanceInfo = {
      id,
      subscriptionId,
      tokenAddress: tokenAddress.toLowerCase(),
      walletAddress: walletAddress.toLowerCase(),
    };

    // Track
    this.subscribedBalances.set(subscriptionId, {
      ...balanceInfo,
      chainId: supportedChainId,
    });

    // Add to batch
    await this.addBalanceToBatch(supportedChainId, wssUrl, balanceInfo);

    log.info({
      chainId,
      subscriptionId,
      tokenAddress: balanceInfo.tokenAddress,
      msg: 'Added balance subscription',
    });
  }

  /**
   * Remove a balance subscription from the worker.
   * Called when subscription is paused or deleted.
   */
  async removeBalance(subscriptionId: string): Promise<void> {
    const balanceInfo = this.subscribedBalances.get(subscriptionId);
    if (!balanceInfo) {
      log.debug({ subscriptionId, msg: 'Balance not found in subscribed list' });
      return;
    }

    // Remove from internal tracking
    this.subscribedBalances.delete(subscriptionId);

    // Remove from batch
    const chainBatches = this.batchesByChain.get(balanceInfo.chainId);
    if (chainBatches) {
      for (const batch of chainBatches) {
        if (batch.hasBalance(subscriptionId)) {
          await batch.removeBalance(subscriptionId);
          break;
        }
      }
    }

    log.info({
      chainId: balanceInfo.chainId,
      subscriptionId,
      msg: 'Removed balance subscription',
    });
  }

  /**
   * Add a balance to an existing batch or create a new batch if needed.
   */
  private async addBalanceToBatch(
    chainId: SupportedChainId,
    wssUrl: string,
    balance: BalanceInfo
  ): Promise<void> {
    const config = getWorkerConfig();
    let chainBatches = this.batchesByChain.get(chainId);

    if (!chainBatches) {
      chainBatches = [];
      this.batchesByChain.set(chainId, chainBatches);
    }

    // Find a batch with room
    let targetBatch = chainBatches.find(
      (batch) => batch.getStatus().subscriptionCount < config.maxPoolsPerConnection
    );

    if (targetBatch) {
      // Add to existing batch
      await targetBatch.addBalance(balance);
      log.info({
        chainId,
        subscriptionId: balance.subscriptionId,
        batchIndex: targetBatch.getStatus().batchIndex,
        msg: 'Added balance to existing batch',
      });
    } else {
      // Create new batch
      const batchIndex = chainBatches.length;
      const newBatch = new Erc20BalanceSubscriptionBatch(chainId, wssUrl, batchIndex, [balance]);
      chainBatches.push(newBatch);
      this.batches.push(newBatch);

      // Start the new batch
      await newBatch.start();
      log.info({
        chainId,
        subscriptionId: balance.subscriptionId,
        batchIndex,
        msg: 'Created new batch for balance',
      });
    }
  }

  // ===========================================================================
  // Polling (for new subscriptions and reactivations)
  // ===========================================================================

  /**
   * Start polling for new subscriptions.
   */
  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.pollNewSubscriptions().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling for new subscriptions',
        });
      });
    }, POLL_INTERVAL_MS);

    log.info({ intervalMs: POLL_INTERVAL_MS, msg: 'Started polling for new subscriptions' });
  }

  /**
   * Stop polling.
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      log.info({ msg: 'Stopped polling for new subscriptions' });
    }
  }

  /**
   * Poll database for new active subscriptions that aren't tracked yet.
   */
  private async pollNewSubscriptions(): Promise<void> {
    // Get all active subscriptions we're NOT yet tracking
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
        status: 'active',
        subscriptionId: {
          notIn: Array.from(this.subscribedBalances.keys()),
        },
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
      },
    });

    if (subscriptions.length === 0) {
      return;
    }

    log.info({ count: subscriptions.length, msg: 'Found new active subscriptions' });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as Erc20BalanceSubscriptionConfig;

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID, skipping' });
        continue;
      }

      await this.addBalance(
        sub.subscriptionId,
        sub.id,
        config.chainId,
        config.tokenAddress,
        config.walletAddress
      );
    }
  }

  // ===========================================================================
  // Cleanup (pause stale, prune deleted)
  // ===========================================================================

  /**
   * Start the cleanup timer.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      Promise.all([
        this.pauseStaleSubscriptions(),
        this.pruneDeletedSubscriptions(),
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
   * Pause subscriptions that haven't been polled in PAUSE_THRESHOLD_MS.
   * Removes them from WebSocket but keeps the DB record.
   */
  private async pauseStaleSubscriptions(): Promise<void> {
    // Find active subscriptions that have an expiry (persistent subscriptions with null expiresAfterMs are skipped)
    const candidates = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
        status: 'active',
        expiresAfterMs: { not: null },
      },
      select: {
        id: true,
        subscriptionId: true,
        lastPolledAt: true,
        expiresAfterMs: true,
      },
    });

    const now = Date.now();
    const staleSubscriptions = candidates.filter((sub) => {
      if (!sub.lastPolledAt || sub.expiresAfterMs == null) return false;
      return now - sub.lastPolledAt.getTime() > sub.expiresAfterMs;
    });

    if (staleSubscriptions.length === 0) {
      return;
    }

    log.info({ count: staleSubscriptions.length, msg: 'Pausing stale subscriptions' });

    const pausedAt = new Date();

    for (const sub of staleSubscriptions) {
      // Update database status to paused
      await prisma.onchainDataSubscribers.update({
        where: { id: sub.id },
        data: {
          status: 'paused',
          pausedAt,
        },
      });

      // Remove from WebSocket batch
      await this.removeBalance(sub.subscriptionId);

      log.info({ subscriptionId: sub.subscriptionId, msg: 'Paused stale subscription' });
    }
  }

  /**
   * Delete subscriptions that have been paused for longer than PRUNE_THRESHOLD_MS.
   */
  private async pruneDeletedSubscriptions(): Promise<void> {
    const cutoffTime = new Date(Date.now() - PRUNE_THRESHOLD_MS);

    // Find paused subscriptions that have been paused for too long
    const toDelete = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
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

    log.info({ count: toDelete.length, msg: 'Pruning old paused subscriptions' });

    // Delete from database
    const subscriptionIds = toDelete.map((sub) => sub.subscriptionId);

    await prisma.onchainDataSubscribers.deleteMany({
      where: {
        subscriptionId: { in: subscriptionIds },
      },
    });

    log.info({ count: toDelete.length, msg: 'Pruned paused subscriptions' });
  }
}
