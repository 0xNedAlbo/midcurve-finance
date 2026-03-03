/**
 * Uniswap V3 Pool Price Provider
 *
 * TEMPORARY: Replaced WebSocket eth_subscribe with HTTP slot0() polling
 * every 15 seconds to diagnose Alchemy WebSocket CU consumption.
 *
 * Publishes synthetic Swap-like events to RabbitMQ for downstream processing.
 */

import { keccak256, toHex } from 'viem';
import { getEvmConfig } from '@midcurve/services';
import { onchainDataLogger, priceLog } from '../../lib/logger';
import { getRabbitMQConnection } from '../../mq/connection-manager';
import { buildUniswapV3RoutingKey } from '../../mq/topology';
import { createRawSwapEvent, serializeRawSwapEvent } from '../../mq/messages';
import type { SupportedChainId } from '../../lib/config';

const log = onchainDataLogger.child({ component: 'UniswapV3PoolProvider' });

/** Maximum pools per batch */
export const MAX_POOLS_PER_SUBSCRIPTION = 1000;

/**
 * Uniswap V3 Swap event signature.
 * Swap(address,address,int256,int256,uint160,uint128,int24)
 */
export const SWAP_EVENT_TOPIC = keccak256(
  toHex('Swap(address,address,int256,int256,uint160,uint128,int24)')
);

/** Polling interval for slot0 reads (15 seconds) */
const POLL_INTERVAL_MS = 15_000;

/** slot0 ABI for multicall */
const SLOT0_ABI = [
  {
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
  },
] as const;

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
 * TEMPORARY: Uses HTTP slot0() polling instead of WebSocket eth_subscribe.
 */
export class UniswapV3PoolSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string; // kept for interface stability
  private readonly batchIndex: number;
  private pools: Map<string, PoolInfo>; // address -> PoolInfo
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  // Track last known tick per pool to skip unchanged prices
  private lastKnownTicks: Map<string, number> = new Map();

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
   */
  async addPool(pool: PoolInfo): Promise<void> {
    const normalizedAddress = pool.address.toLowerCase();

    if (this.pools.has(normalizedAddress)) {
      log.debug({ poolAddress: pool.address, msg: 'Pool already in batch, skipping' });
      return;
    }

    if (this.pools.size >= MAX_POOLS_PER_SUBSCRIPTION) {
      throw new Error(`Batch at max capacity: ${this.pools.size} >= ${MAX_POOLS_PER_SUBSCRIPTION}`);
    }

    this.pools.set(normalizedAddress, pool);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      poolAddress: pool.address,
      newPoolCount: this.pools.size,
      msg: 'Added pool to batch',
    });

    // If batch was stopped, restart it
    if (!this.isRunning) {
      log.info({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Restarting stopped batch for new pool',
      });
      await this.start();
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
   */
  async removePool(poolAddress: string): Promise<void> {
    const normalizedAddress = poolAddress.toLowerCase();

    if (!this.pools.has(normalizedAddress)) {
      log.debug({ poolAddress, msg: 'Pool not in batch, skipping removal' });
      return;
    }

    this.pools.delete(normalizedAddress);
    this.lastKnownTicks.delete(normalizedAddress);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      poolAddress,
      remainingPoolCount: this.pools.size,
      msg: 'Removed pool from batch',
    });

    if (this.isRunning && this.pools.size === 0) {
      await this.stop();
      log.info({ chainId: this.chainId, batchIndex: this.batchIndex, msg: 'Stopped empty batch' });
    }
  }

  /**
   * Start the polling batch.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ chainId: this.chainId, batchIndex: this.batchIndex, msg: 'Batch already running' });
      return;
    }

    this.isRunning = true;

    priceLog.subscription(log, this.chainId, 'subscribed', this.pools.size, {
      batchIndex: this.batchIndex,
    });

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      poolCount: this.pools.size,
      pollIntervalMs: POLL_INTERVAL_MS,
      msg: 'Started slot0 polling batch',
    });

    // Initial poll
    this.pollSlot0().catch((err) => {
      log.error({
        error: err instanceof Error ? err.message : String(err),
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Initial slot0 poll failed',
      });
    });

    // Start polling timer
    this.pollTimer = setInterval(() => {
      this.pollSlot0().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          chainId: this.chainId,
          batchIndex: this.batchIndex,
          msg: 'slot0 poll failed',
        });
      });
    }, POLL_INTERVAL_MS);
  }

  /**
   * Stop the polling batch.
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

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
      isConnected: this.isRunning,
      isRunning: this.isRunning,
    };
  }

  /**
   * Poll slot0() for all pools via multicall and publish changed prices.
   */
  private async pollSlot0(): Promise<void> {
    if (this.pools.size === 0) return;

    const client = getEvmConfig().getPublicClient(this.chainId);
    const poolEntries = Array.from(this.pools.entries());

    const contracts = poolEntries.map(([address]) => ({
      address: address as `0x${string}`,
      abi: SLOT0_ABI,
      functionName: 'slot0' as const,
    }));

    const results = await client.multicall({ contracts, allowFailure: true });

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const [poolAddress] = poolEntries[i]!;

      if (result.status === 'failure') {
        log.warn({
          chainId: this.chainId,
          poolAddress,
          error: result.error?.message,
          msg: 'slot0 multicall failed for pool',
        });
        continue;
      }

      const [sqrtPriceX96, tick] = result.result as unknown as [bigint, number];

      if (sqrtPriceX96 === 0n) continue; // Pool not initialized

      // Skip if tick hasn't changed
      const lastTick = this.lastKnownTicks.get(poolAddress);
      if (lastTick !== undefined && lastTick === tick) continue;

      this.lastKnownTicks.set(poolAddress, tick);

      // Construct synthetic log matching what downstream consumers expect
      const syntheticLog = {
        address: poolAddress,
        args: {
          sqrtPriceX96: sqrtPriceX96.toString(),
          tick,
        },
        blockNumber: null,
        transactionHash: null,
        removed: false,
      };

      priceLog.priceEvent(log, this.chainId, poolAddress, 0, false);

      this.publishEvent(poolAddress, syntheticLog).catch((err) => {
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
   */
  private async publishEvent(poolAddress: string, rawPayload: unknown): Promise<void> {
    const mq = getRabbitMQConnection();

    const event = createRawSwapEvent(this.chainId, poolAddress, rawPayload);
    const routingKey = buildUniswapV3RoutingKey(this.chainId, poolAddress);
    const content = serializeRawSwapEvent(event);
    await mq.publish(routingKey, content);
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
