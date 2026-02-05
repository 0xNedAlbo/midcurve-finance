/**
 * Uniswap V3 Pool Price WebSocket Provider
 *
 * Subscribes to Swap events from Uniswap V3 pools using eth_subscribe.
 * Updates price state in the database when events are received.
 *
 * Key advantage over ERC-20 balance: Swap events contain sqrtPriceX96 and tick
 * directly, so no RPC call is needed after receiving an event.
 *
 * Key constraint: eth_subscribe supports max 1000 addresses per filter.
 * Each instance handles one batch of up to 1000 pools on a single chain.
 */

import {
  createPublicClient,
  webSocket,
  type PublicClient,
  type WatchEventReturnType,
  keccak256,
  toHex,
} from 'viem';
import { onchainDataLogger, priceLog } from '../../lib/logger.js';
import { prisma, Prisma } from '@midcurve/database';
import type { SupportedChainId } from '../../lib/config.js';
import type { UniswapV3PoolPriceSubscriptionState } from '@midcurve/shared';

const log = onchainDataLogger.child({ component: 'UniswapV3PoolPriceProvider' });

/** Maximum pools per WebSocket subscription (eth_subscribe limit) */
export const MAX_POOLS_PER_SUBSCRIPTION = 1000;

/**
 * Uniswap V3 Swap event signature.
 * Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
 */
export const SWAP_EVENT_TOPIC = keccak256(
  toHex('Swap(address,address,int256,int256,uint160,uint128,int24)')
);

/**
 * Pool price subscription info for tracking.
 */
export interface PoolPriceInfo {
  /** Database row ID */
  id: string;
  /** Unique subscription ID for API polling */
  subscriptionId: string;
  /** Pool contract address (normalized) */
  poolAddress: string;
}

/**
 * Uniswap V3 Pool Price subscription batch for a single chain.
 * Each batch handles up to MAX_POOLS_PER_SUBSCRIPTION pools.
 */
export class UniswapV3PoolPriceSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string;
  private readonly batchIndex: number;
  // Map: poolAddress -> PoolPriceInfo
  // Each pool should have only one subscription
  private pools: Map<string, PoolPriceInfo>;
  private wsClient: PublicClient | null = null;
  private unwatch: WatchEventReturnType | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  constructor(
    chainId: SupportedChainId,
    wssUrl: string,
    batchIndex: number,
    pools: PoolPriceInfo[]
  ) {
    this.chainId = chainId;
    this.wssUrl = wssUrl;
    this.batchIndex = batchIndex;
    this.pools = new Map();

    // Index pools by address
    for (const pool of pools) {
      const poolAddr = pool.poolAddress.toLowerCase();
      this.pools.set(poolAddr, pool);
    }

    // Check total subscription count
    if (this.pools.size > MAX_POOLS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch exceeds max pools: ${this.pools.size} > ${MAX_POOLS_PER_SUBSCRIPTION}`
      );
    }
  }

  /**
   * Get total number of pools in this batch.
   */
  get poolCount(): number {
    return this.pools.size;
  }

  /**
   * Add a pool subscription to this batch dynamically.
   * Reconnects the WebSocket to include the new pool in the filter.
   */
  async addPool(pool: PoolPriceInfo): Promise<void> {
    const poolAddr = pool.poolAddress.toLowerCase();

    // Check if this pool already exists
    if (this.pools.has(poolAddr)) {
      log.debug({
        subscriptionId: pool.subscriptionId,
        msg: 'Pool subscription already in batch, skipping',
      });
      return;
    }

    // Check batch capacity
    if (this.poolCount >= MAX_POOLS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch at max capacity: ${this.poolCount} >= ${MAX_POOLS_PER_SUBSCRIPTION}`
      );
    }

    // Add to pools map
    this.pools.set(poolAddr, pool);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      subscriptionId: pool.subscriptionId,
      poolAddress: pool.poolAddress,
      newPoolCount: this.poolCount,
      msg: 'Added pool to batch',
    });

    // Reconnect to update the subscription filter, or restart if batch was stopped
    if (this.isRunning) {
      await this.reconnect();
    } else {
      // Batch was stopped (e.g., all pools were removed), restart it
      log.info({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Restarting stopped batch for new pool',
      });
      await this.start();
    }
  }

  /**
   * Check if this batch contains a subscription.
   */
  hasPool(subscriptionId: string): boolean {
    for (const info of this.pools.values()) {
      if (info.subscriptionId === subscriptionId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all pool addresses in this batch.
   */
  getPoolAddresses(): string[] {
    return Array.from(this.pools.keys());
  }

  /**
   * Get pool info by subscription ID.
   */
  getPoolInfo(subscriptionId: string): PoolPriceInfo | undefined {
    for (const info of this.pools.values()) {
      if (info.subscriptionId === subscriptionId) {
        return info;
      }
    }
    return undefined;
  }

  /**
   * Update the subscription info for a pool without removing it from the batch.
   * Used when one subscription is removed but others for the same pool remain.
   *
   * Updates both the subscriptionId and the database row id, so that Swap events
   * update the correct database record.
   */
  updatePoolSubscription(
    oldSubscriptionId: string,
    newSubscriptionId: string,
    newId: string
  ): void {
    for (const [poolAddr, info] of this.pools.entries()) {
      if (info.subscriptionId === oldSubscriptionId) {
        this.pools.set(poolAddr, {
          ...info,
          id: newId,
          subscriptionId: newSubscriptionId,
        });
        log.info({
          chainId: this.chainId,
          batchIndex: this.batchIndex,
          oldSubscriptionId,
          newSubscriptionId,
          newId,
          poolAddress: poolAddr,
          msg: 'Updated pool subscription in batch',
        });
        return;
      }
    }
  }

  /**
   * Remove a pool subscription from this batch.
   * Reconnects the WebSocket to update the filter.
   */
  async removePool(subscriptionId: string): Promise<void> {
    let poolAddrToRemove: string | null = null;

    for (const [poolAddr, info] of this.pools.entries()) {
      if (info.subscriptionId === subscriptionId) {
        poolAddrToRemove = poolAddr;
        break;
      }
    }

    if (!poolAddrToRemove) {
      log.debug({
        subscriptionId,
        msg: 'Pool not found in batch',
      });
      return;
    }

    this.pools.delete(poolAddrToRemove);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      subscriptionId,
      remainingPoolCount: this.poolCount,
      msg: 'Removed pool from batch',
    });

    // Reconnect to update the subscription filter (if still running and has pools)
    if (this.isRunning && this.pools.size > 0) {
      await this.reconnect();
    } else if (this.isRunning && this.pools.size === 0) {
      // Stop the batch if no subscriptions remain
      await this.stop();
      log.info({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Stopped empty batch',
      });
    }
  }

  /**
   * Reconnect the WebSocket with updated pool list.
   */
  private async reconnect(): Promise<void> {
    // Stop current subscription
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
    this.wsClient = null;

    // Reconnect
    await this.connect();
  }

  /**
   * Start the subscription batch.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Batch already running',
      });
      return;
    }

    this.isRunning = true;
    await this.connect();
  }

  /**
   * Stop the subscription batch.
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }

    this.wsClient = null;

    priceLog.subscription(log, this.chainId, 'unsubscribed', this.poolCount, {
      batchIndex: this.batchIndex,
    });
  }

  /**
   * Get batch status.
   */
  getStatus(): {
    chainId: number;
    batchIndex: number;
    poolCount: number;
    isConnected: boolean;
    isRunning: boolean;
  } {
    return {
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      poolCount: this.poolCount,
      isConnected: this.wsClient !== null && this.unwatch !== null,
      isRunning: this.isRunning,
    };
  }

  /**
   * Connect to WebSocket and subscribe to events.
   */
  private async connect(): Promise<void> {
    priceLog.wsConnection(log, this.chainId, 'connecting', {
      batchIndex: this.batchIndex,
      poolCount: this.poolCount,
    });

    try {
      // Create viem client with WebSocket transport
      this.wsClient = createPublicClient({
        transport: webSocket(this.wssUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      // Get pool addresses for the filter
      const poolAddresses = Array.from(this.pools.keys()) as `0x${string}`[];

      // Subscribe to Swap events for all pools in this batch
      this.unwatch = this.wsClient.watchEvent({
        address: poolAddresses,
        event: {
          type: 'event',
          name: 'Swap',
          inputs: [
            { type: 'address', name: 'sender', indexed: true },
            { type: 'address', name: 'recipient', indexed: true },
            { type: 'int256', name: 'amount0', indexed: false },
            { type: 'int256', name: 'amount1', indexed: false },
            { type: 'uint160', name: 'sqrtPriceX96', indexed: false },
            { type: 'uint128', name: 'liquidity', indexed: false },
            { type: 'int24', name: 'tick', indexed: false },
          ],
        },
        onLogs: (logs) => this.handleLogs(logs),
        onError: (error) => this.handleError(error),
      });

      this.reconnectAttempts = 0;

      priceLog.wsConnection(log, this.chainId, 'connected', {
        batchIndex: this.batchIndex,
        poolCount: this.poolCount,
      });

      priceLog.subscription(log, this.chainId, 'subscribed', this.poolCount, {
        batchIndex: this.batchIndex,
      });
    } catch (error) {
      priceLog.wsConnection(log, this.chainId, 'error', {
        batchIndex: this.batchIndex,
        error: error instanceof Error ? error.message : String(error),
      });

      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming log events.
   */
  private handleLogs(logs: unknown[]): void {
    for (const rawLog of logs) {
      // Extract data from the log
      const logData = rawLog as {
        address?: string;
        blockNumber?: bigint;
        transactionHash?: string;
        removed?: boolean;
        args?: {
          sender?: string;
          recipient?: string;
          amount0?: bigint;
          amount1?: bigint;
          sqrtPriceX96?: bigint;
          liquidity?: bigint;
          tick?: number;
        };
      };

      const poolAddress = logData.address?.toLowerCase() || '';
      const blockNumber = logData.blockNumber ? Number(logData.blockNumber) : null;
      const txHash = logData.transactionHash || null;
      const removed = logData.removed || false;
      const sqrtPriceX96 = logData.args?.sqrtPriceX96;
      const tick = logData.args?.tick;

      log.debug({
        chainId: this.chainId,
        poolAddress,
        sqrtPriceX96: sqrtPriceX96?.toString(),
        tick,
        blockNumber,
        removed,
        msg: `Swap event: ${poolAddress}`,
      });

      // Skip removed (reorg) events
      if (removed) {
        log.debug({
          chainId: this.chainId,
          poolAddress,
          msg: 'Skipping removed (reorg) swap event',
        });
        continue;
      }

      // Validate we have the required data
      if (sqrtPriceX96 === undefined || tick === undefined) {
        log.warn({
          chainId: this.chainId,
          poolAddress,
          msg: 'Swap event missing sqrtPriceX96 or tick',
        });
        continue;
      }

      // Find matching subscription
      const poolInfo = this.pools.get(poolAddress);
      if (!poolInfo) {
        log.debug({
          chainId: this.chainId,
          poolAddress,
          msg: 'No subscription found for pool',
        });
        continue;
      }

      // Update database state
      this.updatePoolPriceState(poolInfo, sqrtPriceX96, tick, blockNumber, txHash).catch(
        (err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            chainId: this.chainId,
            subscriptionId: poolInfo.subscriptionId,
            msg: 'Failed to update pool price state',
          });
        }
      );
    }
  }

  /**
   * Update pool price state in database.
   * No RPC call needed - Swap event contains the price directly.
   */
  private async updatePoolPriceState(
    pool: PoolPriceInfo,
    sqrtPriceX96: bigint,
    tick: number,
    blockNumber: number | null,
    txHash: string | null
  ): Promise<void> {
    const now = new Date();

    // Get current state
    const subscription = await prisma.onchainDataSubscribers.findUnique({
      where: { id: pool.id },
    });

    if (!subscription || subscription.status === 'deleted') {
      log.warn({
        subscriptionId: pool.subscriptionId,
        msg: 'Subscription not found or deleted, skipping update',
      });
      return;
    }

    const currentState = subscription.state as unknown as UniswapV3PoolPriceSubscriptionState;

    // Only update if this event is newer (by block number)
    if (
      currentState.lastEventBlock !== null &&
      blockNumber !== null &&
      blockNumber < currentState.lastEventBlock
    ) {
      log.debug({
        subscriptionId: pool.subscriptionId,
        currentBlock: currentState.lastEventBlock,
        eventBlock: blockNumber,
        msg: 'Skipping older event',
      });
      return;
    }

    const newState: UniswapV3PoolPriceSubscriptionState = {
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      lastEventBlock: blockNumber,
      lastEventTxHash: txHash,
      lastUpdatedAt: now.toISOString(),
    };

    await prisma.onchainDataSubscribers.update({
      where: { id: pool.id },
      data: {
        state: newState as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    log.info({
      chainId: this.chainId,
      subscriptionId: pool.subscriptionId,
      poolAddress: pool.poolAddress,
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      blockNumber,
      msg: 'Updated pool price state',
    });
  }

  /**
   * Handle WebSocket errors.
   */
  private handleError(error: Error): void {
    priceLog.wsConnection(log, this.chainId, 'error', {
      batchIndex: this.batchIndex,
      error: error.message,
    });

    // Clean up current connection
    this.unwatch = null;
    this.wsClient = null;

    // Schedule reconnect if still running
    if (this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Max reconnect attempts reached, giving up',
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelayMs * this.reconnectAttempts;

    priceLog.wsConnection(log, this.chainId, 'reconnecting', {
      batchIndex: this.batchIndex,
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs: delay,
    });

    setTimeout(() => {
      if (this.isRunning) {
        this.connect().catch((err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            chainId: this.chainId,
            batchIndex: this.batchIndex,
            msg: 'Reconnect failed',
          });
        });
      }
    }, delay);
  }
}

/**
 * Create subscription batches for a chain.
 * Splits pools into batches of MAX_POOLS_PER_SUBSCRIPTION.
 */
export function createPoolPriceSubscriptionBatches(
  chainId: SupportedChainId,
  wssUrl: string,
  pools: PoolPriceInfo[]
): UniswapV3PoolPriceSubscriptionBatch[] {
  const batches: UniswapV3PoolPriceSubscriptionBatch[] = [];

  for (let i = 0; i < pools.length; i += MAX_POOLS_PER_SUBSCRIPTION) {
    const batchPools = pools.slice(i, i + MAX_POOLS_PER_SUBSCRIPTION);
    const batchIndex = Math.floor(i / MAX_POOLS_PER_SUBSCRIPTION);

    batches.push(
      new UniswapV3PoolPriceSubscriptionBatch(chainId, wssUrl, batchIndex, batchPools)
    );
  }

  log.info({
    chainId,
    totalPools: pools.length,
    batchCount: batches.length,
    msg: `Created ${batches.length} pool price subscription batches`,
  });

  return batches;
}
