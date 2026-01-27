/**
 * Uniswap V3 Pool WebSocket Provider
 *
 * Subscribes to Swap events from Uniswap V3 pools using eth_subscribe.
 * Publishes raw events to RabbitMQ for downstream processing.
 *
 * Key constraint: eth_subscribe supports max 1000 addresses per filter.
 * Each instance handles one batch of up to 1000 pools on a single chain.
 */

import { createPublicClient, webSocket, type PublicClient, type WatchEventReturnType, keccak256, toHex } from 'viem';
import { onchainDataLogger, priceLog } from '../../lib/logger';
import { getRabbitMQConnection } from '../../mq/connection-manager';
import { buildUniswapV3RoutingKey } from '../../mq/topology';
import { createRawSwapEvent, serializeRawSwapEvent } from '../../mq/messages';
import type { SupportedChainId } from '../../lib/config';

const log = onchainDataLogger.child({ component: 'UniswapV3PoolProvider' });

/** Maximum pools per WebSocket subscription (eth_subscribe limit) */
export const MAX_POOLS_PER_SUBSCRIPTION = 1000;

/**
 * Uniswap V3 Swap event signature.
 * Swap(address,address,int256,int256,uint160,uint128,int24)
 */
export const SWAP_EVENT_TOPIC = keccak256(
  toHex('Swap(address,address,int256,int256,uint160,uint128,int24)')
);

/**
 * Pool address with its database ID for tracking.
 */
export interface PoolInfo {
  /** Pool contract address (0x...) */
  address: string;
  /** Pool database ID for reference */
  poolId: string;
}

/**
 * UniswapV3 subscription batch for a single chain.
 * Each batch handles up to MAX_POOLS_PER_SUBSCRIPTION pools.
 */
export class UniswapV3PoolSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string;
  private readonly batchIndex: number;
  private pools: Map<string, PoolInfo>; // address -> PoolInfo
  private client: PublicClient | null = null;
  private unwatch: WatchEventReturnType | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  constructor(
    chainId: SupportedChainId,
    wssUrl: string,
    batchIndex: number,
    pools: PoolInfo[]
  ) {
    this.chainId = chainId;
    this.wssUrl = wssUrl;
    this.batchIndex = batchIndex;
    this.pools = new Map(pools.map((p) => [p.address.toLowerCase(), p]));

    if (pools.length > MAX_POOLS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch exceeds max pools: ${pools.length} > ${MAX_POOLS_PER_SUBSCRIPTION}`
      );
    }
  }

  /**
   * Add a pool to this batch dynamically.
   * Reconnects the WebSocket to include the new pool in the filter.
   */
  async addPool(pool: PoolInfo): Promise<void> {
    const normalizedAddress = pool.address.toLowerCase();

    // Check if already subscribed
    if (this.pools.has(normalizedAddress)) {
      log.debug({ poolAddress: pool.address, msg: 'Pool already in batch, skipping' });
      return;
    }

    // Check batch capacity
    if (this.pools.size >= MAX_POOLS_PER_SUBSCRIPTION) {
      throw new Error(`Batch at max capacity: ${this.pools.size} >= ${MAX_POOLS_PER_SUBSCRIPTION}`);
    }

    // Add to pool map
    this.pools.set(normalizedAddress, pool);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      poolAddress: pool.address,
      newPoolCount: this.pools.size,
      msg: 'Added pool to batch',
    });

    // Reconnect to update the subscription filter
    if (this.isRunning) {
      await this.reconnect();
    }
  }

  /**
   * Check if this batch contains a pool.
   */
  hasPool(poolAddress: string): boolean {
    return this.pools.has(poolAddress.toLowerCase());
  }

  /**
   * Get all pool addresses in this batch.
   */
  getPoolAddresses(): string[] {
    return Array.from(this.pools.keys());
  }

  /**
   * Get pool info by address.
   */
  getPoolInfo(poolAddress: string): PoolInfo | undefined {
    return this.pools.get(poolAddress.toLowerCase());
  }

  /**
   * Remove a pool from this batch.
   * Reconnects the WebSocket to update the filter, or stops if no pools remain.
   */
  async removePool(poolAddress: string): Promise<void> {
    const normalizedAddress = poolAddress.toLowerCase();

    if (!this.pools.has(normalizedAddress)) {
      log.debug({ poolAddress, msg: 'Pool not in batch, skipping removal' });
      return;
    }

    this.pools.delete(normalizedAddress);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      poolAddress,
      remainingPoolCount: this.pools.size,
      msg: 'Removed pool from batch',
    });

    // Reconnect to update the subscription filter (if still running and has pools)
    if (this.isRunning && this.pools.size > 0) {
      await this.reconnect();
    } else if (this.isRunning && this.pools.size === 0) {
      // Stop the batch if no pools remain
      await this.stop();
      log.info({ chainId: this.chainId, batchIndex: this.batchIndex, msg: 'Stopped empty batch' });
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
    this.client = null;

    // Reconnect
    await this.connect();
  }

  /**
   * Start the subscription batch.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ chainId: this.chainId, batchIndex: this.batchIndex, msg: 'Batch already running' });
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

    // Note: viem's WebSocket client doesn't expose a direct close method
    // Setting client to null allows garbage collection
    this.client = null;

    priceLog.subscription(log, this.chainId, 'unsubscribed', this.pools.size, {
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
      poolCount: this.pools.size,
      isConnected: this.client !== null && this.unwatch !== null,
      isRunning: this.isRunning,
    };
  }

  /**
   * Connect to WebSocket and subscribe to events.
   */
  private async connect(): Promise<void> {
    priceLog.wsConnection(log, this.chainId, 'connecting', {
      batchIndex: this.batchIndex,
      poolCount: this.pools.size,
    });

    try {
      // Create viem client with WebSocket transport
      this.client = createPublicClient({
        transport: webSocket(this.wssUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      // Get pool addresses for the filter
      const poolAddresses = Array.from(this.pools.keys()) as `0x${string}`[];

      // Subscribe to Swap events for all pools in this batch
      this.unwatch = this.client.watchEvent({
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
        poolCount: this.pools.size,
      });

      priceLog.subscription(log, this.chainId, 'subscribed', this.pools.size, {
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
      // Extract address from the log if available
      const logData = rawLog as { address?: string; blockNumber?: bigint; removed?: boolean };
      const poolAddress = logData.address?.toLowerCase() || 'unknown';
      const blockNumber = logData.blockNumber ? Number(logData.blockNumber) : 0;
      const removed = logData.removed || false;

      priceLog.priceEvent(log, this.chainId, poolAddress, blockNumber, removed);

      // Publish raw event to RabbitMQ
      this.publishEvent(poolAddress, rawLog).catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          chainId: this.chainId,
          poolAddress,
          msg: 'Failed to publish event',
        });
      });
    }
  }

  /**
   * Publish a raw event to RabbitMQ.
   *
   * Note: This service does NOT update lastAliveAt - that's the responsibility
   * of downstream RabbitMQ consumers who must send heartbeats every 15 seconds.
   */
  private async publishEvent(poolAddress: string, rawPayload: unknown): Promise<void> {
    const mq = getRabbitMQConnection();

    // Create wrapped event
    const event = createRawSwapEvent(this.chainId, poolAddress, rawPayload);

    // Build routing key: uniswapv3.{chainId}.{poolAddress}
    const routingKey = buildUniswapV3RoutingKey(this.chainId, poolAddress);

    // Serialize and publish
    const content = serializeRawSwapEvent(event);
    await mq.publish(routingKey, content);
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
    this.client = null;

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
export function createSubscriptionBatches(
  chainId: SupportedChainId,
  wssUrl: string,
  pools: PoolInfo[]
): UniswapV3PoolSubscriptionBatch[] {
  const batches: UniswapV3PoolSubscriptionBatch[] = [];

  for (let i = 0; i < pools.length; i += MAX_POOLS_PER_SUBSCRIPTION) {
    const batchPools = pools.slice(i, i + MAX_POOLS_PER_SUBSCRIPTION);
    const batchIndex = Math.floor(i / MAX_POOLS_PER_SUBSCRIPTION);

    batches.push(new UniswapV3PoolSubscriptionBatch(chainId, wssUrl, batchIndex, batchPools));
  }

  log.info({
    chainId,
    totalPools: pools.length,
    batchCount: batches.length,
    msg: `Created ${batches.length} subscription batches`,
  });

  return batches;
}
