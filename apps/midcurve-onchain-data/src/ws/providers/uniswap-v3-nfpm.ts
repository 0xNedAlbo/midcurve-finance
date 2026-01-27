/**
 * Uniswap V3 NFPM WebSocket Provider
 *
 * Subscribes to position liquidity events from the NonfungiblePositionManager contract:
 * - IncreaseLiquidity: Liquidity added to position
 * - DecreaseLiquidity: Liquidity removed from position
 * - Collect: Fees/tokens collected from position
 *
 * Key constraint: eth_subscribe supports max 1000 topic values per filter.
 * Each instance handles one batch of up to 1000 positions (nftIds) on a single chain.
 */

import {
  createPublicClient,
  webSocket,
  type PublicClient,
  type WatchEventReturnType,
  type Address,
} from 'viem';
import { onchainDataLogger, priceLog } from '../../lib/logger';
import { getRabbitMQConnection } from '../../mq/connection-manager';
import { buildPositionLiquidityRoutingKey } from '../../mq/topology';
import {
  createRawPositionEvent,
  serializeRawPositionEvent,
  type PositionEventType,
} from '../../mq/position-messages';
import type { SupportedChainId } from '../../lib/config';
import { UNISWAP_V3_POSITION_MANAGER_ADDRESSES } from '@midcurve/services';

const log = onchainDataLogger.child({ component: 'NfpmProvider' });

/** Maximum positions per WebSocket subscription (topic array limit) */
export const MAX_POSITIONS_PER_SUBSCRIPTION = 1000;

/**
 * NFPM event ABIs for subscription.
 */
const INCREASE_LIQUIDITY_EVENT = {
  type: 'event',
  name: 'IncreaseLiquidity',
  inputs: [
    { type: 'uint256', name: 'tokenId', indexed: true },
    { type: 'uint128', name: 'liquidity', indexed: false },
    { type: 'uint256', name: 'amount0', indexed: false },
    { type: 'uint256', name: 'amount1', indexed: false },
  ],
} as const;

const DECREASE_LIQUIDITY_EVENT = {
  type: 'event',
  name: 'DecreaseLiquidity',
  inputs: [
    { type: 'uint256', name: 'tokenId', indexed: true },
    { type: 'uint128', name: 'liquidity', indexed: false },
    { type: 'uint256', name: 'amount0', indexed: false },
    { type: 'uint256', name: 'amount1', indexed: false },
  ],
} as const;

const COLLECT_EVENT = {
  type: 'event',
  name: 'Collect',
  inputs: [
    { type: 'uint256', name: 'tokenId', indexed: true },
    { type: 'address', name: 'recipient', indexed: false },
    { type: 'uint256', name: 'amount0', indexed: false },
    { type: 'uint256', name: 'amount1', indexed: false },
  ],
} as const;

/**
 * Position info with nftId and database ID for tracking.
 */
export interface PositionInfo {
  /** NFT ID (tokenId) from the position */
  nftId: string;
  /** Position database ID for reference */
  positionId: string;
}

/**
 * Callback for block number updates from WebSocket events.
 * Used by the subscriber to track the latest processed block per chain.
 */
export type BlockUpdateCallback = (chainId: number, blockNumber: bigint) => void;

/**
 * NFPM subscription batch for a single chain.
 * Each batch handles up to MAX_POSITIONS_PER_SUBSCRIPTION positions.
 */
export class UniswapV3NfpmSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string;
  private readonly batchIndex: number;
  private readonly nfpmAddress: Address;
  private positions: Map<string, PositionInfo>; // nftId -> PositionInfo
  private client: PublicClient | null = null;
  private unwatchIncrease: WatchEventReturnType | null = null;
  private unwatchDecrease: WatchEventReturnType | null = null;
  private unwatchCollect: WatchEventReturnType | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  /** Optional callback for block number updates (used for block tracking) */
  private onBlockUpdate: BlockUpdateCallback | null = null;

  constructor(
    chainId: SupportedChainId,
    wssUrl: string,
    batchIndex: number,
    positions: PositionInfo[]
  ) {
    this.chainId = chainId;
    this.wssUrl = wssUrl;
    this.batchIndex = batchIndex;
    this.nfpmAddress = UNISWAP_V3_POSITION_MANAGER_ADDRESSES[chainId];
    this.positions = new Map(positions.map((p) => [p.nftId, p]));

    if (positions.length > MAX_POSITIONS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch exceeds max positions: ${positions.length} > ${MAX_POSITIONS_PER_SUBSCRIPTION}`
      );
    }
  }

  /**
   * Set the block update callback.
   * Called when events are received with the block number.
   */
  setBlockUpdateCallback(callback: BlockUpdateCallback | null): void {
    this.onBlockUpdate = callback;
  }

  /**
   * Add a position to this batch dynamically.
   * Reconnects the WebSocket to include the new position in the filter.
   */
  async addPosition(position: PositionInfo): Promise<void> {
    // Check if already subscribed
    if (this.positions.has(position.nftId)) {
      log.debug({ nftId: position.nftId, msg: 'Position already in batch, skipping' });
      return;
    }

    // Check batch capacity
    if (this.positions.size >= MAX_POSITIONS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch at max capacity: ${this.positions.size} >= ${MAX_POSITIONS_PER_SUBSCRIPTION}`
      );
    }

    // Add to position map
    this.positions.set(position.nftId, position);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      nftId: position.nftId,
      newPositionCount: this.positions.size,
      msg: 'Added position to batch',
    });

    // Reconnect to update the subscription filter
    if (this.isRunning) {
      await this.reconnect();
    }
  }

  /**
   * Check if this batch contains a position.
   */
  hasPosition(nftId: string): boolean {
    return this.positions.has(nftId);
  }

  /**
   * Get all nftIds in this batch.
   */
  getNftIds(): string[] {
    return Array.from(this.positions.keys());
  }

  /**
   * Get position info by nftId.
   */
  getPositionInfo(nftId: string): PositionInfo | undefined {
    return this.positions.get(nftId);
  }

  /**
   * Get the number of positions in this batch.
   */
  getPositionCount(): number {
    return this.positions.size;
  }

  /**
   * Check if this batch has capacity for more positions.
   */
  hasCapacity(): boolean {
    return this.positions.size < MAX_POSITIONS_PER_SUBSCRIPTION;
  }

  /**
   * Remove a position from this batch.
   * Reconnects the WebSocket to update the filter, or stops if no positions remain.
   */
  async removePosition(nftId: string): Promise<void> {
    if (!this.positions.has(nftId)) {
      log.debug({ nftId, msg: 'Position not in batch, skipping removal' });
      return;
    }

    this.positions.delete(nftId);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      nftId,
      remainingPositionCount: this.positions.size,
      msg: 'Removed position from batch',
    });

    // Reconnect to update the subscription filter (if still running and has positions)
    if (this.isRunning && this.positions.size > 0) {
      await this.reconnect();
    } else if (this.isRunning && this.positions.size === 0) {
      // Stop the batch if no positions remain
      await this.stop();
      log.info({ chainId: this.chainId, batchIndex: this.batchIndex, msg: 'Stopped empty batch' });
    }
  }

  /**
   * Reconnect the WebSocket with updated position list.
   */
  private async reconnect(): Promise<void> {
    // Stop current subscriptions
    this.stopWatchers();
    this.client = null;

    // Reconnect
    await this.connect();
  }

  /**
   * Stop all event watchers.
   */
  private stopWatchers(): void {
    if (this.unwatchIncrease) {
      this.unwatchIncrease();
      this.unwatchIncrease = null;
    }
    if (this.unwatchDecrease) {
      this.unwatchDecrease();
      this.unwatchDecrease = null;
    }
    if (this.unwatchCollect) {
      this.unwatchCollect();
      this.unwatchCollect = null;
    }
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
    this.stopWatchers();

    // Note: viem's WebSocket client doesn't expose a direct close method
    // Setting client to null allows garbage collection
    this.client = null;

    priceLog.subscription(log, this.chainId, 'unsubscribed', this.positions.size, {
      batchIndex: this.batchIndex,
      type: 'nfpm',
    });
  }

  /**
   * Get batch status.
   */
  getStatus(): {
    chainId: number;
    batchIndex: number;
    positionCount: number;
    isConnected: boolean;
    isRunning: boolean;
  } {
    return {
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      positionCount: this.positions.size,
      isConnected: this.client !== null && this.unwatchIncrease !== null,
      isRunning: this.isRunning,
    };
  }

  /**
   * Connect to WebSocket and subscribe to events.
   */
  private async connect(): Promise<void> {
    priceLog.wsConnection(log, this.chainId, 'connecting', {
      batchIndex: this.batchIndex,
      positionCount: this.positions.size,
      type: 'nfpm',
    });

    try {
      // Create viem client with WebSocket transport
      this.client = createPublicClient({
        transport: webSocket(this.wssUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      // Get nftIds for the filter (as bigint array)
      const tokenIds = Array.from(this.positions.keys()).map((id) => BigInt(id));

      // Subscribe to IncreaseLiquidity events
      this.unwatchIncrease = this.client.watchEvent({
        address: this.nfpmAddress,
        event: INCREASE_LIQUIDITY_EVENT,
        args: { tokenId: tokenIds },
        onLogs: (logs) => this.handleLogs(logs, 'INCREASE_LIQUIDITY'),
        onError: (error) => this.handleError(error),
      });

      // Subscribe to DecreaseLiquidity events
      this.unwatchDecrease = this.client.watchEvent({
        address: this.nfpmAddress,
        event: DECREASE_LIQUIDITY_EVENT,
        args: { tokenId: tokenIds },
        onLogs: (logs) => this.handleLogs(logs, 'DECREASE_LIQUIDITY'),
        onError: (error) => this.handleError(error),
      });

      // Subscribe to Collect events
      this.unwatchCollect = this.client.watchEvent({
        address: this.nfpmAddress,
        event: COLLECT_EVENT,
        args: { tokenId: tokenIds },
        onLogs: (logs) => this.handleLogs(logs, 'COLLECT'),
        onError: (error) => this.handleError(error),
      });

      this.reconnectAttempts = 0;

      priceLog.wsConnection(log, this.chainId, 'connected', {
        batchIndex: this.batchIndex,
        positionCount: this.positions.size,
        type: 'nfpm',
      });

      priceLog.subscription(log, this.chainId, 'subscribed', this.positions.size, {
        batchIndex: this.batchIndex,
        type: 'nfpm',
      });
    } catch (error) {
      priceLog.wsConnection(log, this.chainId, 'error', {
        batchIndex: this.batchIndex,
        error: error instanceof Error ? error.message : String(error),
        type: 'nfpm',
      });

      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming log events.
   */
  private handleLogs(logs: unknown[], eventType: PositionEventType): void {
    for (const rawLog of logs) {
      // Extract tokenId from the log args
      const logData = rawLog as {
        args?: { tokenId?: bigint };
        blockNumber?: bigint;
        removed?: boolean;
      };
      const tokenId = logData.args?.tokenId;
      const nftId = tokenId ? tokenId.toString() : 'unknown';
      const blockNumber = logData.blockNumber ? Number(logData.blockNumber) : 0;
      const removed = logData.removed || false;

      log.debug({
        chainId: this.chainId,
        nftId,
        eventType,
        blockNumber,
        removed,
        msg: `Position event: ${eventType} nftId=${nftId} block=${blockNumber}${removed ? ' (removed)' : ''}`,
      });

      // Notify subscriber of block number for block tracking
      if (logData.blockNumber && this.onBlockUpdate) {
        this.onBlockUpdate(this.chainId, logData.blockNumber);
      }

      // Publish raw event to RabbitMQ
      this.publishEvent(nftId, eventType, rawLog).catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          chainId: this.chainId,
          nftId,
          eventType,
          msg: 'Failed to publish position event',
        });
      });
    }
  }

  /**
   * Publish a raw event to RabbitMQ.
   */
  private async publishEvent(
    nftId: string,
    eventType: PositionEventType,
    rawPayload: unknown
  ): Promise<void> {
    const mq = getRabbitMQConnection();

    // Create wrapped event
    const event = createRawPositionEvent(this.chainId, nftId, eventType, rawPayload);

    // Build routing key: uniswapv3.{chainId}.{nftId}
    const routingKey = buildPositionLiquidityRoutingKey(this.chainId, nftId);

    // Serialize and publish
    const content = serializeRawPositionEvent(event);
    await mq.publishPositionEvent(routingKey, content);
  }

  /**
   * Handle WebSocket errors.
   */
  private handleError(error: Error): void {
    priceLog.wsConnection(log, this.chainId, 'error', {
      batchIndex: this.batchIndex,
      error: error.message,
      type: 'nfpm',
    });

    // Clean up current connection
    this.stopWatchers();
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
      type: 'nfpm',
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
 * Create NFPM subscription batches for a chain.
 * Splits positions into batches of MAX_POSITIONS_PER_SUBSCRIPTION.
 */
export function createUniswapV3NfpmSubscriptionBatches(
  chainId: SupportedChainId,
  wssUrl: string,
  positions: PositionInfo[]
): UniswapV3NfpmSubscriptionBatch[] {
  const batches: UniswapV3NfpmSubscriptionBatch[] = [];

  for (let i = 0; i < positions.length; i += MAX_POSITIONS_PER_SUBSCRIPTION) {
    const batchPositions = positions.slice(i, i + MAX_POSITIONS_PER_SUBSCRIPTION);
    const batchIndex = Math.floor(i / MAX_POSITIONS_PER_SUBSCRIPTION);

    batches.push(new UniswapV3NfpmSubscriptionBatch(chainId, wssUrl, batchIndex, batchPositions));
  }

  log.info({
    chainId,
    totalPositions: positions.length,
    batchCount: batches.length,
    msg: `Created ${batches.length} NFPM subscription batches`,
  });

  return batches;
}
