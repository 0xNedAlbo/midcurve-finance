/**
 * Erc20ApprovalSubscriber Worker
 *
 * Manages WebSocket subscriptions for ERC-20 token approval events.
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
  Erc20ApprovalSubscriptionBatch,
  createApprovalSubscriptionBatches,
  type ApprovalInfo,
} from '../ws/providers/erc20-approval.js';
import type {
  Erc20ApprovalSubscriptionConfig,
} from '@midcurve/shared';

const log = onchainDataLogger.child({ component: 'Erc20ApprovalSubscriber' });

/** Threshold for pausing subscriptions (default: 60 seconds) */
const PAUSE_THRESHOLD_MS = parseInt(process.env.APPROVAL_STALE_THRESHOLD_MS || '60000', 10);

/** Threshold for deleting paused subscriptions (default: 5 minutes) */
const PRUNE_THRESHOLD_MS = parseInt(process.env.APPROVAL_PRUNE_THRESHOLD_MS || '300000', 10);

/** Interval for checking stale subscriptions (default: 30 seconds) */
const CLEANUP_INTERVAL_MS = parseInt(process.env.APPROVAL_CLEANUP_INTERVAL_MS || '30000', 10);

/** Interval for polling new subscriptions (default: 5 seconds) */
const POLL_INTERVAL_MS = parseInt(process.env.APPROVAL_POLL_INTERVAL_MS || '5000', 10);

/**
 * Erc20ApprovalSubscriber manages WebSocket subscriptions for approval events.
 * Subscriptions are created via the API and managed by this worker.
 */
export class Erc20ApprovalSubscriber {
  private batches: Erc20ApprovalSubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, Erc20ApprovalSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Track subscribed approvals by subscriptionId
  private subscribedApprovals: Map<string, ApprovalInfo & { chainId: SupportedChainId }> = new Map();

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

    priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'starting');

    try {
      // Load active subscriptions from database
      const approvalsByChain = await this.loadActiveSubscriptions();

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
        const approvals = approvalsByChain.get(chainId);

        if (!approvals || approvals.length === 0) {
          log.info({ chainId, msg: 'No active approval subscriptions for chain, skipping' });
          continue;
        }

        const chainBatches = createApprovalSubscriptionBatches(chainId, wssConfig.url, approvals);
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

      const totalApprovals = this.batches.reduce(
        (sum, batch) => sum + batch.getStatus().subscriptionCount,
        0
      );

      priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'started', {
        batchCount: this.batches.length,
        totalApprovals,
      });
    } catch (error) {
      priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'error', {
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

    priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'stopping');

    // Stop timers
    this.stopCleanup();
    this.stopPolling();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.subscribedApprovals.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'stopped');
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
      totalSubscriptions: this.subscribedApprovals.size,
      batches: this.batches.map((batch) => batch.getStatus()),
    };
  }

  /**
   * Load active subscriptions from database.
   * Groups by chain ID for batch creation.
   */
  private async loadActiveSubscriptions(): Promise<Map<SupportedChainId, ApprovalInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    // Query active erc20-approval subscriptions
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-approval',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
      },
    });

    log.info({ subscriptionCount: subscriptions.length, msg: 'Loaded active approval subscriptions' });

    // Group by chain ID
    const approvalsByChain = new Map<SupportedChainId, ApprovalInfo[]>();

    for (const sub of subscriptions) {
      const config = sub.config as unknown as Erc20ApprovalSubscriptionConfig;

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
      const normalizedOwner = config.walletAddress.toLowerCase();
      const normalizedSpender = config.spenderAddress.toLowerCase();

      const approvalInfo: ApprovalInfo = {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        tokenAddress: normalizedToken,
        ownerAddress: normalizedOwner,
        spenderAddress: normalizedSpender,
      };

      // Track in internal state
      this.subscribedApprovals.set(sub.subscriptionId, {
        ...approvalInfo,
        chainId,
      });

      // Add to chain grouping
      if (!approvalsByChain.has(chainId)) {
        approvalsByChain.set(chainId, []);
      }

      approvalsByChain.get(chainId)!.push(approvalInfo);
    }

    // Log summary
    for (const [chainId, chainApprovals] of approvalsByChain) {
      log.info({ chainId, approvalCount: chainApprovals.length, msg: 'Approvals grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');

    return approvalsByChain;
  }

  // ===========================================================================
  // Subscription Lifecycle Management
  // ===========================================================================

  /**
   * Add an approval subscription to the worker.
   * Called when API creates a new subscription or reactivates a paused one.
   */
  async addApproval(
    subscriptionId: string,
    id: string,
    chainId: number,
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string
  ): Promise<void> {
    // Validate chain
    if (!isSupportedChain(chainId)) {
      log.warn({ chainId, subscriptionId, msg: 'Unsupported chain ID, cannot add approval' });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;

    // Check if already subscribed
    if (this.subscribedApprovals.has(subscriptionId)) {
      log.debug({ subscriptionId, msg: 'Approval already subscribed' });
      return;
    }

    // Get WSS URL
    const wssUrl = getWssUrl(supportedChainId);
    if (!wssUrl) {
      log.warn({ chainId, subscriptionId, msg: 'No WSS URL configured for chain' });
      return;
    }

    const approvalInfo: ApprovalInfo = {
      id,
      subscriptionId,
      tokenAddress: tokenAddress.toLowerCase(),
      ownerAddress: ownerAddress.toLowerCase(),
      spenderAddress: spenderAddress.toLowerCase(),
    };

    // Track
    this.subscribedApprovals.set(subscriptionId, {
      ...approvalInfo,
      chainId: supportedChainId,
    });

    // Add to batch
    await this.addApprovalToBatch(supportedChainId, wssUrl, approvalInfo);

    log.info({
      chainId,
      subscriptionId,
      tokenAddress: approvalInfo.tokenAddress,
      msg: 'Added approval subscription',
    });
  }

  /**
   * Remove an approval subscription from the worker.
   * Called when subscription is paused or deleted.
   */
  async removeApproval(subscriptionId: string): Promise<void> {
    const approvalInfo = this.subscribedApprovals.get(subscriptionId);
    if (!approvalInfo) {
      log.debug({ subscriptionId, msg: 'Approval not found in subscribed list' });
      return;
    }

    // Remove from internal tracking
    this.subscribedApprovals.delete(subscriptionId);

    // Remove from batch
    const chainBatches = this.batchesByChain.get(approvalInfo.chainId);
    if (chainBatches) {
      for (const batch of chainBatches) {
        if (batch.hasApproval(subscriptionId)) {
          await batch.removeApproval(subscriptionId);
          break;
        }
      }
    }

    log.info({
      chainId: approvalInfo.chainId,
      subscriptionId,
      msg: 'Removed approval subscription',
    });
  }

  /**
   * Add an approval to an existing batch or create a new batch if needed.
   */
  private async addApprovalToBatch(
    chainId: SupportedChainId,
    wssUrl: string,
    approval: ApprovalInfo
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
      await targetBatch.addApproval(approval);
      log.info({
        chainId,
        subscriptionId: approval.subscriptionId,
        batchIndex: targetBatch.getStatus().batchIndex,
        msg: 'Added approval to existing batch',
      });
    } else {
      // Create new batch
      const batchIndex = chainBatches.length;
      const newBatch = new Erc20ApprovalSubscriptionBatch(chainId, wssUrl, batchIndex, [approval]);
      chainBatches.push(newBatch);
      this.batches.push(newBatch);

      // Start the new batch
      await newBatch.start();
      log.info({
        chainId,
        subscriptionId: approval.subscriptionId,
        batchIndex,
        msg: 'Created new batch for approval',
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
        subscriptionType: 'erc20-approval',
        status: 'active',
        subscriptionId: {
          notIn: Array.from(this.subscribedApprovals.keys()),
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
      const config = sub.config as unknown as Erc20ApprovalSubscriptionConfig;

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID, skipping' });
        continue;
      }

      await this.addApproval(
        sub.subscriptionId,
        sub.id,
        config.chainId,
        config.tokenAddress,
        config.walletAddress,
        config.spenderAddress
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
        subscriptionType: 'erc20-approval',
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
      await this.removeApproval(sub.subscriptionId);

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
        subscriptionType: 'erc20-approval',
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
