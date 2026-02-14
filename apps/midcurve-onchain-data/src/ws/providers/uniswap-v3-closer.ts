/**
 * Uniswap V3 Position Closer WebSocket Provider
 *
 * Subscribes to lifecycle events from UniswapV3PositionCloser diamond contracts:
 * - Registration: OrderRegistered, OrderCancelled
 * - Config Updates: OrderOperatorUpdated, OrderPayoutUpdated, OrderTriggerTickUpdated,
 *   OrderValidUntilUpdated, OrderSlippageUpdated, OrderSwapIntentUpdated
 *
 * Watches one or more contract addresses on a single chain.
 * Publishes structured domain events to RabbitMQ.
 *
 * Key constraint: eth_subscribe supports max 1000 addresses per filter.
 * Each instance handles one batch of up to 1000 contracts on a single chain.
 */

import {
  createPublicClient,
  webSocket,
  type PublicClient,
  type WatchEventReturnType,
} from 'viem';
import { onchainDataLogger, priceLog } from '../../lib/logger';
import { getRabbitMQConnection } from '../../mq/connection-manager';
import { buildCloseOrderRoutingKey } from '../../mq/topology';
import {
  buildCloseOrderEvent,
  serializeCloseOrderEvent,
  CLOSER_LIFECYCLE_EVENT_ABIS,
  type AnyCloseOrderEvent,
  type RawEventLog,
} from '../../mq/close-order-messages';
import type { SupportedChainId } from '../../lib/config';

const log = onchainDataLogger.child({ component: 'CloserProvider' });

/** Maximum contract addresses per WebSocket subscription (eth_subscribe limit) */
export const MAX_CONTRACTS_PER_SUBSCRIPTION = 1000;

/**
 * Contract address with chainId for routing.
 */
export interface CloserContractInfo {
  address: string;
  chainId: number;
}

/**
 * Buffered close order event for deferred publishing.
 * Used during catch-up to prevent race conditions with reorgs.
 */
interface BufferedCloseOrderEvent {
  domainEvent: AnyCloseOrderEvent;
  blockNumber: bigint | undefined;
}

/**
 * Callback for block number updates from WebSocket events.
 */
export type BlockUpdateCallback = (chainId: number, blockNumber: bigint) => void;

/**
 * UniswapV3PositionCloser subscription batch for a single chain.
 * Each batch handles up to MAX_CONTRACTS_PER_SUBSCRIPTION contracts.
 */
export class UniswapV3CloserSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string;
  private readonly batchIndex: number;
  private contracts: Map<string, CloserContractInfo>; // lowercase address -> info
  private client: PublicClient | null = null;
  private unwatch: WatchEventReturnType | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  private onBlockUpdate: BlockUpdateCallback | null = null;

  /** Buffering mode flag - when true, ALL events are buffered instead of published */
  private isBuffering = false;
  /** Buffer for events collected during buffering mode */
  private eventBuffer: BufferedCloseOrderEvent[] = [];

  constructor(
    chainId: SupportedChainId,
    wssUrl: string,
    batchIndex: number,
    contracts: CloserContractInfo[]
  ) {
    this.chainId = chainId;
    this.wssUrl = wssUrl;
    this.batchIndex = batchIndex;
    this.contracts = new Map(contracts.map((c) => [c.address.toLowerCase(), c]));

    if (contracts.length > MAX_CONTRACTS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch exceeds max contracts: ${contracts.length} > ${MAX_CONTRACTS_PER_SUBSCRIPTION}`
      );
    }
  }

  /**
   * Set the block update callback.
   */
  setBlockUpdateCallback(callback: BlockUpdateCallback | null): void {
    this.onBlockUpdate = callback;
  }

  /**
   * Enable buffering mode.
   */
  enableBuffering(): void {
    this.isBuffering = true;
    this.eventBuffer = [];
    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      msg: 'Buffering mode enabled',
    });
  }

  /**
   * Check if buffering mode is enabled.
   */
  isBufferingEnabled(): boolean {
    return this.isBuffering;
  }

  /**
   * Get the number of buffered events.
   */
  getBufferedEventCount(): number {
    return this.eventBuffer.length;
  }

  /**
   * Flush all buffered events and disable buffering mode.
   * Events are published in the order they were received.
   */
  async flushBufferAndDisableBuffering(): Promise<number> {
    const eventCount = this.eventBuffer.length;

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      bufferedEvents: eventCount,
      msg: 'Flushing buffered close order events',
    });

    for (const buffered of this.eventBuffer) {
      try {
        await this.publishDomainEvent(buffered.domainEvent);
      } catch (err) {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          chainId: this.chainId,
          eventType: buffered.domainEvent.type,
          nftId: buffered.domainEvent.nftId,
          msg: 'Failed to publish buffered close order event',
        });
      }
    }

    this.eventBuffer = [];
    this.isBuffering = false;

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      flushedEvents: eventCount,
      msg: 'Buffering mode disabled, close order events flushed',
    });

    return eventCount;
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

    this.client = null;

    priceLog.subscription(log, this.chainId, 'unsubscribed', this.contracts.size, {
      batchIndex: this.batchIndex,
      component: 'closer',
    });
  }

  /**
   * Get batch status.
   */
  getStatus(): {
    chainId: number;
    batchIndex: number;
    contractCount: number;
    isConnected: boolean;
    isRunning: boolean;
    isBuffering: boolean;
    bufferedEvents: number;
  } {
    return {
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      contractCount: this.contracts.size,
      isConnected: this.client !== null && this.unwatch !== null,
      isRunning: this.isRunning,
      isBuffering: this.isBuffering,
      bufferedEvents: this.eventBuffer.length,
    };
  }

  /**
   * Connect to WebSocket and subscribe to closer lifecycle events.
   */
  private async connect(): Promise<void> {
    priceLog.wsConnection(log, this.chainId, 'connecting', {
      batchIndex: this.batchIndex,
      contractCount: this.contracts.size,
      component: 'closer',
    });

    try {
      this.client = createPublicClient({
        transport: webSocket(this.wssUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      const contractAddresses = Array.from(this.contracts.keys()) as `0x${string}`[];

      // Subscribe to all 8 lifecycle events from the closer contracts
      this.unwatch = this.client.watchEvent({
        address: contractAddresses,
        events: CLOSER_LIFECYCLE_EVENT_ABIS,
        onLogs: (logs) => this.handleLogs(logs),
        onError: (error) => this.handleError(error),
      });

      this.reconnectAttempts = 0;

      priceLog.wsConnection(log, this.chainId, 'connected', {
        batchIndex: this.batchIndex,
        contractCount: this.contracts.size,
        component: 'closer',
      });

      priceLog.subscription(log, this.chainId, 'subscribed', this.contracts.size, {
        batchIndex: this.batchIndex,
        component: 'closer',
      });
    } catch (error) {
      priceLog.wsConnection(log, this.chainId, 'error', {
        batchIndex: this.batchIndex,
        error: error instanceof Error ? error.message : String(error),
        component: 'closer',
      });

      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming log events from WebSocket.
   */
  private handleLogs(logs: unknown[]): void {
    for (const rawLog of logs) {
      const logData = rawLog as RawEventLog;

      // Notify block tracker
      if (logData.blockNumber && this.onBlockUpdate) {
        this.onBlockUpdate(this.chainId, logData.blockNumber);
      }

      const contractAddress = logData.address?.toLowerCase() || 'unknown';

      // Build the domain event
      const domainEvent = buildCloseOrderEvent(this.chainId, contractAddress, logData);
      if (!domainEvent) continue;

      if (this.isBuffering) {
        // Buffer during catch-up
        this.eventBuffer.push({
          domainEvent,
          blockNumber: logData.blockNumber,
        });
      } else {
        // Publish immediately
        this.publishDomainEvent(domainEvent).catch((err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            chainId: this.chainId,
            eventType: domainEvent.type,
            nftId: domainEvent.nftId,
            msg: 'Failed to publish close order event',
          });
        });
      }
    }
  }

  /**
   * Publish a domain event to RabbitMQ.
   */
  private async publishDomainEvent(event: AnyCloseOrderEvent): Promise<void> {
    const mq = getRabbitMQConnection();
    const routingKey = buildCloseOrderRoutingKey(this.chainId, event.nftId, event.triggerMode);
    const content = serializeCloseOrderEvent(event);
    await mq.publishCloseOrderEvent(routingKey, content);
  }

  /**
   * Handle WebSocket errors.
   */
  private handleError(error: Error): void {
    priceLog.wsConnection(log, this.chainId, 'error', {
      batchIndex: this.batchIndex,
      error: error.message,
      component: 'closer',
    });

    this.unwatch = null;
    this.client = null;

    if (this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (!this.isRunning) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Max reconnect attempts reached for closer subscriber, giving up',
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
      component: 'closer',
    });

    setTimeout(() => {
      if (this.isRunning) {
        this.connect().catch((err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            chainId: this.chainId,
            batchIndex: this.batchIndex,
            msg: 'Closer subscriber reconnect failed',
          });
        });
      }
    }, delay);
  }
}

/**
 * Create subscription batches for closer contracts on a chain.
 * Splits into batches of MAX_CONTRACTS_PER_SUBSCRIPTION.
 */
export function createCloserSubscriptionBatches(
  chainId: SupportedChainId,
  wssUrl: string,
  contracts: CloserContractInfo[]
): UniswapV3CloserSubscriptionBatch[] {
  const batches: UniswapV3CloserSubscriptionBatch[] = [];

  for (let i = 0; i < contracts.length; i += MAX_CONTRACTS_PER_SUBSCRIPTION) {
    const batchContracts = contracts.slice(i, i + MAX_CONTRACTS_PER_SUBSCRIPTION);
    const batchIndex = Math.floor(i / MAX_CONTRACTS_PER_SUBSCRIPTION);

    batches.push(new UniswapV3CloserSubscriptionBatch(chainId, wssUrl, batchIndex, batchContracts));
  }

  log.info({
    chainId,
    totalContracts: contracts.length,
    batchCount: batches.length,
    msg: `Created ${batches.length} closer subscription batches`,
  });

  return batches;
}
