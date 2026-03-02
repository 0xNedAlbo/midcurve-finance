/**
 * UniswapV3PoolPriceSubscriber Worker
 *
 * Consumes Swap events from the pool-prices RabbitMQ exchange (published by
 * PoolPriceSubscriber) and updates the onchainDataSubscribers table with
 * the latest sqrtPriceX96 and tick for each tracked pool.
 *
 * This eliminates a duplicate WebSocket subscription — previously both this
 * worker and PoolPriceSubscriber maintained separate eth_subscribe calls for
 * the same Swap events.
 *
 * Subscription lifecycle:
 * - active: receiving price updates from RabbitMQ
 * - paused: removed from tracking after expiresAfterMs without polling
 * - deleted: cleaned up after 5min in paused state
 *
 * API endpoint handles reactivation when a paused subscription is polled.
 */

import type { Channel, ConsumeMessage } from 'amqplib';
import { prisma, Prisma } from '@midcurve/database';
import { getEvmConfig } from '@midcurve/services';
import { onchainDataLogger, priceLog } from '../lib/logger.js';
import {
  isSupportedChain,
  type SupportedChainId,
} from '../lib/config.js';
import { getRabbitMQConnection } from '../mq/connection-manager.js';
import { EXCHANGE_POOL_PRICES } from '../mq/topology.js';
import type { RawSwapEventWrapper } from '../mq/messages.js';
import type {
  UniswapV3PoolPriceSubscriptionConfig,
  UniswapV3PoolPriceSubscriptionState,
} from '@midcurve/shared';

const log = onchainDataLogger.child({ component: 'UniswapV3PoolPriceSubscriber' });

/** Queue name for consuming pool price events */
const QUEUE_NAME = 'onchain-data.pool-price-updates';

/** Threshold for pausing subscriptions (default: 60 seconds) */
const PAUSE_THRESHOLD_MS = parseInt(process.env.POOL_PRICE_STALE_THRESHOLD_MS || '60000', 10);

/** Threshold for deleting paused subscriptions (default: 5 minutes) */
const PRUNE_THRESHOLD_MS = parseInt(process.env.POOL_PRICE_PRUNE_THRESHOLD_MS || '300000', 10);

/** Interval for checking stale subscriptions (default: 30 seconds) */
const CLEANUP_INTERVAL_MS = parseInt(process.env.POOL_PRICE_CLEANUP_INTERVAL_MS || '30000', 10);

/** Interval for polling new subscriptions (default: 5 seconds) */
const POLL_INTERVAL_MS = parseInt(process.env.POOL_PRICE_POLL_INTERVAL_MS || '5000', 10);

interface TrackedPool {
  id: string;
  subscriptionId: string;
  poolAddress: string;
  chainId: SupportedChainId;
}

/**
 * UniswapV3PoolPriceSubscriber consumes Swap events from RabbitMQ and
 * updates subscription state in the database.
 */
export class UniswapV3PoolPriceSubscriber {
  private isRunning = false;

  // Track subscribed pools by subscriptionId
  private subscribedPools: Map<string, TrackedPool> = new Map();

  // RabbitMQ consumer
  private consumerTag: string | null = null;
  private channel: Channel | null = null;

  // Timers
  private cleanupTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads active subscriptions and starts consuming from RabbitMQ.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'starting');

    // Load active subscriptions from database
    await this.loadActiveSubscriptions();

    // Set up RabbitMQ consumer
    const mq = getRabbitMQConnection();
    this.channel = await mq.getChannel();

    await this.channel.assertQueue(QUEUE_NAME, {
      durable: true,
      autoDelete: false,
    });

    await this.channel.bindQueue(QUEUE_NAME, EXCHANGE_POOL_PRICES, 'uniswapv3.#');

    const { consumerTag } = await this.channel.consume(
      QUEUE_NAME,
      (msg) => {
        if (msg) this.handleSwapMessage(msg);
      },
      { noAck: true },
    );

    this.consumerTag = consumerTag;

    this.isRunning = true;

    // Read initial prices for all subscribed pools via slot0()
    // Group by (chainId, poolAddress) to avoid redundant reads
    const poolGroups = new Map<string, { chainId: SupportedChainId; poolAddress: string; dbIds: string[] }>();
    for (const [, poolInfo] of this.subscribedPools) {
      const key = `${poolInfo.chainId}:${poolInfo.poolAddress}`;
      const group = poolGroups.get(key);
      if (group) {
        group.dbIds.push(poolInfo.id);
      } else {
        poolGroups.set(key, {
          chainId: poolInfo.chainId,
          poolAddress: poolInfo.poolAddress,
          dbIds: [poolInfo.id],
        });
      }
    }

    for (const group of poolGroups.values()) {
      // Fire and forget — don't block startup
      this.readInitialPrice(group.chainId, group.poolAddress, group.dbIds)
        .catch(() => {}); // Error already logged inside readInitialPrice
    }

    // Start cleanup timer (pause stale, prune deleted)
    this.startCleanup();

    // Start polling for new subscriptions
    this.startPolling();

    priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'started', {
      totalSubscriptions: this.subscribedPools.size,
    });
  }

  /**
   * Stop the subscriber.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'Subscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'stopping');

    // Stop timers
    this.stopCleanup();
    this.stopPolling();

    // Cancel RabbitMQ consumer
    if (this.consumerTag && this.channel) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }
    this.channel = null;

    this.subscribedPools.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'UniswapV3PoolPriceSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    totalSubscriptions: number;
  } {
    return {
      isRunning: this.isRunning,
      totalSubscriptions: this.subscribedPools.size,
    };
  }

  // ===========================================================================
  // RabbitMQ Message Handling
  // ===========================================================================

  /**
   * Handle a Swap event message from the pool-prices exchange.
   * Parses the raw event and updates matching subscriptions in the database.
   */
  private handleSwapMessage(msg: ConsumeMessage): void {
    const event = JSON.parse(msg.content.toString()) as RawSwapEventWrapper;
    const poolAddress = event.poolAddress;
    const chainId = event.chainId;

    // Find matching subscriptions for this pool
    const matchingIds: string[] = [];
    for (const [, info] of this.subscribedPools) {
      if (info.chainId === chainId && info.poolAddress === poolAddress) {
        matchingIds.push(info.id);
      }
    }

    if (matchingIds.length === 0) return;

    // Parse the raw swap event (bigints are serialized as strings by bigIntReplacer)
    const raw = event.raw as {
      args?: { sqrtPriceX96?: string; tick?: number };
      blockNumber?: string;
      transactionHash?: string;
      removed?: boolean;
    };

    if (raw.removed) return;
    if (!raw.args?.sqrtPriceX96 || raw.args?.tick === undefined) return;

    const sqrtPriceX96 = raw.args.sqrtPriceX96;
    const tick = raw.args.tick;
    const blockNumber = raw.blockNumber ? Number(raw.blockNumber) : null;
    const txHash = raw.transactionHash || null;

    this.updateSubscriptions(poolAddress, matchingIds, sqrtPriceX96, tick, blockNumber, txHash)
      .catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          chainId,
          poolAddress,
          subscriptionCount: matchingIds.length,
          msg: 'Failed to update pool price state',
        });
      });
  }

  /**
   * Update pool price state for matching subscriptions.
   */
  private async updateSubscriptions(
    poolAddress: string,
    subscriptionDbIds: string[],
    sqrtPriceX96: string,
    tick: number,
    blockNumber: number | null,
    txHash: string | null,
  ): Promise<void> {
    const now = new Date();

    const newState: UniswapV3PoolPriceSubscriptionState = {
      sqrtPriceX96,
      tick,
      lastEventBlock: blockNumber,
      lastEventTxHash: txHash,
      lastUpdatedAt: now.toISOString(),
    };

    const result = await prisma.onchainDataSubscribers.updateMany({
      where: {
        id: { in: subscriptionDbIds },
        status: { not: 'deleted' },
      },
      data: {
        state: newState as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    log.info({
      poolAddress,
      sqrtPriceX96,
      tick,
      blockNumber,
      subscriptionsUpdated: result.count,
      totalSubscriptions: subscriptionDbIds.length,
      msg: 'Updated pool price state for all subscriptions',
    });
  }

  // ===========================================================================
  // Subscription Loading & Tracking
  // ===========================================================================

  /**
   * Load active subscriptions from database.
   */
  private async loadActiveSubscriptions(): Promise<void> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
      },
    });

    log.info({
      subscriptionCount: subscriptions.length,
      msg: 'Loaded active pool price subscriptions',
    });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as UniswapV3PoolPriceSubscriptionConfig;

      if (!config.chainId || !config.poolAddress) {
        log.warn({
          subscriptionId: sub.subscriptionId,
          msg: 'Subscription config missing chainId or poolAddress',
        });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({
          chainId: config.chainId,
          subscriptionId: sub.subscriptionId,
          msg: 'Unsupported chain ID',
        });
        continue;
      }

      this.subscribedPools.set(sub.subscriptionId, {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        poolAddress: config.poolAddress.toLowerCase(),
        chainId: config.chainId as SupportedChainId,
      });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');
  }

  // ===========================================================================
  // Subscription Lifecycle Management
  // ===========================================================================

  /**
   * Add a pool subscription to the worker.
   * Called when a new subscription is found during polling.
   */
  async addPool(
    subscriptionId: string,
    id: string,
    chainId: number,
    poolAddress: string
  ): Promise<void> {
    if (!isSupportedChain(chainId)) {
      log.warn({ chainId, subscriptionId, msg: 'Unsupported chain ID, cannot add pool' });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;

    if (this.subscribedPools.has(subscriptionId)) {
      log.debug({ subscriptionId, msg: 'Pool already subscribed' });
      return;
    }

    this.subscribedPools.set(subscriptionId, {
      id,
      subscriptionId,
      poolAddress: poolAddress.toLowerCase(),
      chainId: supportedChainId,
    });

    // Read initial price from slot0() so the subscription has a valid price immediately
    await this.readInitialPrice(supportedChainId, poolAddress.toLowerCase(), [id]);

    log.info({
      chainId,
      subscriptionId,
      poolAddress: poolAddress.toLowerCase(),
      msg: 'Added pool subscription',
    });
  }

  /**
   * Remove a pool subscription from the worker.
   * Called when subscription is paused or deleted.
   */
  removePool(subscriptionId: string): void {
    const poolInfo = this.subscribedPools.get(subscriptionId);
    if (!poolInfo) {
      log.debug({ subscriptionId, msg: 'Pool not found in subscribed list' });
      return;
    }

    this.subscribedPools.delete(subscriptionId);

    log.info({
      chainId: poolInfo.chainId,
      subscriptionId,
      poolAddress: poolInfo.poolAddress,
      msg: 'Removed pool subscription',
    });
  }

  /**
   * Read the current pool price via slot0() and update subscription state in DB.
   * Called on startup and when dynamically adding new subscriptions so the price
   * is immediately correct without waiting for the next Swap event.
   */
  private async readInitialPrice(
    chainId: SupportedChainId,
    poolAddress: string,
    subscriptionDbIds: string[],
  ): Promise<void> {
    try {
      const client = getEvmConfig().getPublicClient(chainId);
      const result = await client.readContract({
        address: poolAddress as `0x${string}`,
        abi: [{
          name: 'slot0',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [
            { name: 'sqrtPriceX96', type: 'uint160' },
            { name: 'tick', type: 'int24' },
            { name: 'observationIndex', type: 'uint16' },
            { name: 'observationCardinality', type: 'uint16' },
            { name: 'observationCardinalityNext', type: 'uint16' },
            { name: 'feeProtocol', type: 'uint8' },
            { name: 'unlocked', type: 'bool' },
          ],
        }],
        functionName: 'slot0',
      });

      const [sqrtPriceX96, tick] = result as unknown as [bigint, number];

      if (sqrtPriceX96 === 0n) return; // Pool not initialized

      const now = new Date();
      const newState: UniswapV3PoolPriceSubscriptionState = {
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick,
        lastEventBlock: null,
        lastEventTxHash: null,
        lastUpdatedAt: now.toISOString(),
      };

      await prisma.onchainDataSubscribers.updateMany({
        where: { id: { in: subscriptionDbIds }, status: { not: 'deleted' } },
        data: {
          state: newState as unknown as Prisma.InputJsonValue,
          updatedAt: now,
        },
      });

      log.info({
        chainId,
        poolAddress,
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick,
        subscriptionCount: subscriptionDbIds.length,
        msg: 'Initial slot0 read completed',
      });
    } catch (error) {
      log.warn({
        chainId,
        poolAddress,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed initial slot0 read (will rely on Swap events)',
      });
    }
  }

  // ===========================================================================
  // Polling (for new subscriptions and reactivations)
  // ===========================================================================

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

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      log.info({ msg: 'Stopped polling for new subscriptions' });
    }
  }

  private async pollNewSubscriptions(): Promise<void> {
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
        status: 'active',
        subscriptionId: {
          notIn: Array.from(this.subscribedPools.keys()),
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
      const config = sub.config as unknown as UniswapV3PoolPriceSubscriptionConfig;

      if (!isSupportedChain(config.chainId)) {
        log.warn({
          chainId: config.chainId,
          subscriptionId: sub.subscriptionId,
          msg: 'Unsupported chain ID, skipping',
        });
        continue;
      }

      await this.addPool(sub.subscriptionId, sub.id, config.chainId, config.poolAddress);
    }
  }

  // ===========================================================================
  // Cleanup (pause stale, prune deleted)
  // ===========================================================================

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      Promise.all([
        this.pauseStaleSubscriptions(),
        this.pruneDeletedSubscriptions(),
        this.removeDeletedFromTracking(),
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

  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      log.info({ msg: 'Stopped cleanup timer' });
    }
  }

  /**
   * Pause subscriptions that haven't been polled within their expiresAfterMs window.
   */
  private async pauseStaleSubscriptions(): Promise<void> {
    const candidates = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
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
      await prisma.onchainDataSubscribers.update({
        where: { id: sub.id },
        data: {
          status: 'paused',
          pausedAt,
        },
      });

      this.removePool(sub.subscriptionId);

      log.info({ subscriptionId: sub.subscriptionId, msg: 'Paused stale subscription' });
    }
  }

  /**
   * Delete subscriptions that have been paused for longer than PRUNE_THRESHOLD_MS.
   */
  private async pruneDeletedSubscriptions(): Promise<void> {
    const cutoffTime = new Date(Date.now() - PRUNE_THRESHOLD_MS);

    const toDelete = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
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

    const subscriptionIds = toDelete.map((sub) => sub.subscriptionId);

    await prisma.onchainDataSubscribers.deleteMany({
      where: {
        subscriptionId: { in: subscriptionIds },
      },
    });

    log.info({ count: toDelete.length, msg: 'Pruned paused subscriptions' });
  }

  /**
   * Remove subscriptions from tracking that were marked as 'deleted' via API.
   */
  private async removeDeletedFromTracking(): Promise<void> {
    if (this.subscribedPools.size === 0) {
      return;
    }

    const trackedIds = Array.from(this.subscribedPools.keys());

    const deletedSubscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'uniswapv3-pool-price',
        subscriptionId: { in: trackedIds },
        status: 'deleted',
      },
      select: {
        subscriptionId: true,
      },
    });

    if (deletedSubscriptions.length === 0) {
      return;
    }

    log.info({
      count: deletedSubscriptions.length,
      msg: 'Removing deleted subscriptions from tracking',
    });

    for (const sub of deletedSubscriptions) {
      this.removePool(sub.subscriptionId);
    }
  }
}
