/**
 * Uniswap V3 NFPM Transfer WebSocket Provider
 *
 * Subscribes to ERC-721 Transfer events from the NonfungiblePositionManager contract
 * to detect position lifecycle events:
 * - MINT: Transfer from address(0) → new position created
 * - BURN: Transfer to address(0) → position destroyed
 * - TRANSFER: Neither address is zero → ownership change
 *
 * Uses two subscriptions per batch:
 * 1. Outgoing: from = [tracked wallets] → catches burns + outgoing transfers
 * 2. Incoming: to = [tracked wallets] → catches mints + incoming transfers
 *
 * Key constraint: eth_subscribe supports max 1000 topic values per filter.
 * Each instance handles one batch of up to 1000 wallet addresses on a single chain.
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
import { buildNfpmTransferRoutingKey, type NfpmTransferEventType } from '../../mq/topology';
import {
  createNfpmTransferEvent,
  serializeNfpmTransferEvent,
} from '../../mq/transfer-messages';
import type { SupportedChainId } from '../../lib/config';
import { UNISWAP_V3_POSITION_MANAGER_ADDRESSES } from '@midcurve/services';

const log = onchainDataLogger.child({ component: 'NfpmTransferProvider' });

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Maximum wallets per WebSocket subscription (topic array limit) */
export const MAX_WALLETS_PER_SUBSCRIPTION = 1000;

/**
 * ERC-721 Transfer event ABI.
 * Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
 */
const TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { type: 'address', name: 'from', indexed: true },
    { type: 'address', name: 'to', indexed: true },
    { type: 'uint256', name: 'tokenId', indexed: true },
  ],
} as const;

/**
 * Classify a Transfer event based on from/to addresses.
 */
function classifyTransferEvent(from: string, to: string): NfpmTransferEventType {
  if (from.toLowerCase() === ZERO_ADDRESS) return 'MINT';
  if (to.toLowerCase() === ZERO_ADDRESS) return 'BURN';
  return 'TRANSFER';
}

/**
 * NFPM Transfer subscription batch for a single chain.
 * Each batch handles up to MAX_WALLETS_PER_SUBSCRIPTION wallet addresses.
 */
export class UniswapV3NfpmTransferSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string;
  private readonly batchIndex: number;
  private readonly nfpmAddress: Address;
  private walletAddresses: Set<string>; // lowercase wallet addresses
  private client: PublicClient | null = null;
  private unwatchOutgoing: WatchEventReturnType | null = null;
  private unwatchIncoming: WatchEventReturnType | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  constructor(
    chainId: SupportedChainId,
    wssUrl: string,
    batchIndex: number,
    walletAddresses: string[],
  ) {
    this.chainId = chainId;
    this.wssUrl = wssUrl;
    this.batchIndex = batchIndex;
    this.nfpmAddress = UNISWAP_V3_POSITION_MANAGER_ADDRESSES[chainId];
    this.walletAddresses = new Set(walletAddresses.map((a) => a.toLowerCase()));

    if (walletAddresses.length > MAX_WALLETS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch exceeds max wallets: ${walletAddresses.length} > ${MAX_WALLETS_PER_SUBSCRIPTION}`,
      );
    }
  }

  /**
   * Add a wallet address to this batch.
   * Reconnects the WebSocket to include the new address in the filter.
   */
  async addWallet(address: string): Promise<void> {
    const normalized = address.toLowerCase();

    if (this.walletAddresses.has(normalized)) {
      log.debug({ address: normalized, msg: 'Wallet already in batch, skipping' });
      return;
    }

    if (this.walletAddresses.size >= MAX_WALLETS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch at max capacity: ${this.walletAddresses.size} >= ${MAX_WALLETS_PER_SUBSCRIPTION}`,
      );
    }

    this.walletAddresses.add(normalized);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      address: normalized,
      newWalletCount: this.walletAddresses.size,
      msg: 'Added wallet to transfer batch',
    });

    if (this.isRunning) {
      await this.reconnect();
    } else {
      await this.start();
    }
  }

  /**
   * Remove a wallet address from this batch.
   */
  async removeWallet(address: string): Promise<void> {
    const normalized = address.toLowerCase();

    if (!this.walletAddresses.has(normalized)) {
      return;
    }

    this.walletAddresses.delete(normalized);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      address: normalized,
      remainingWalletCount: this.walletAddresses.size,
      msg: 'Removed wallet from transfer batch',
    });

    if (this.isRunning && this.walletAddresses.size > 0) {
      await this.reconnect();
    } else if (this.isRunning && this.walletAddresses.size === 0) {
      await this.stop();
    }
  }

  /**
   * Check if this batch has capacity for more wallets.
   */
  hasCapacity(): boolean {
    return this.walletAddresses.size < MAX_WALLETS_PER_SUBSCRIPTION;
  }

  /**
   * Check if this batch contains a wallet.
   */
  hasWallet(address: string): boolean {
    return this.walletAddresses.has(address.toLowerCase());
  }

  /**
   * Get the number of wallets in this batch.
   */
  getWalletCount(): number {
    return this.walletAddresses.size;
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
    this.client = null;

    priceLog.subscription(log, this.chainId, 'unsubscribed', this.walletAddresses.size, {
      batchIndex: this.batchIndex,
      type: 'nfpm-transfer',
    });
  }

  /**
   * Get batch status.
   */
  getStatus(): {
    chainId: number;
    batchIndex: number;
    walletCount: number;
    isConnected: boolean;
    isRunning: boolean;
  } {
    return {
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      walletCount: this.walletAddresses.size,
      isConnected: this.client !== null && this.unwatchOutgoing !== null,
      isRunning: this.isRunning,
    };
  }

  /**
   * Reconnect the WebSocket with updated wallet list.
   */
  private async reconnect(): Promise<void> {
    this.stopWatchers();
    this.client = null;
    await this.connect();
  }

  /**
   * Stop all event watchers.
   */
  private stopWatchers(): void {
    if (this.unwatchOutgoing) {
      this.unwatchOutgoing();
      this.unwatchOutgoing = null;
    }
    if (this.unwatchIncoming) {
      this.unwatchIncoming();
      this.unwatchIncoming = null;
    }
  }

  /**
   * Connect to WebSocket and subscribe to Transfer events.
   */
  private async connect(): Promise<void> {
    priceLog.wsConnection(log, this.chainId, 'connecting', {
      batchIndex: this.batchIndex,
      walletCount: this.walletAddresses.size,
      type: 'nfpm-transfer',
    });

    try {
      this.client = createPublicClient({
        transport: webSocket(this.wssUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      const walletArray = Array.from(this.walletAddresses) as Address[];

      // Subscription 1: Outgoing transfers (from = tracked wallets)
      // Catches: burns (to=0x0) + outgoing transfers
      this.unwatchOutgoing = this.client.watchEvent({
        address: this.nfpmAddress,
        event: TRANSFER_EVENT,
        args: { from: walletArray },
        onLogs: (logs) => this.handleLogs(logs),
        onError: (error) => this.handleError(error),
      });

      // Subscription 2: Incoming transfers (to = tracked wallets)
      // Catches: mints (from=0x0) + incoming transfers
      this.unwatchIncoming = this.client.watchEvent({
        address: this.nfpmAddress,
        event: TRANSFER_EVENT,
        args: { to: walletArray },
        onLogs: (logs) => this.handleLogs(logs),
        onError: (error) => this.handleError(error),
      });

      this.reconnectAttempts = 0;

      priceLog.wsConnection(log, this.chainId, 'connected', {
        batchIndex: this.batchIndex,
        walletCount: this.walletAddresses.size,
        type: 'nfpm-transfer',
      });

      priceLog.subscription(log, this.chainId, 'subscribed', this.walletAddresses.size, {
        batchIndex: this.batchIndex,
        type: 'nfpm-transfer',
      });
    } catch (error) {
      priceLog.wsConnection(log, this.chainId, 'error', {
        batchIndex: this.batchIndex,
        error: error instanceof Error ? error.message : String(error),
        type: 'nfpm-transfer',
      });

      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming Transfer log events.
   */
  private handleLogs(logs: unknown[]): void {
    for (const rawLog of logs) {
      const logData = rawLog as {
        args?: { from?: string; to?: string; tokenId?: bigint };
        blockNumber?: bigint;
        removed?: boolean;
      };

      const from = logData.args?.from ?? ZERO_ADDRESS;
      const to = logData.args?.to ?? ZERO_ADDRESS;
      const tokenId = logData.args?.tokenId;
      const nftId = tokenId ? tokenId.toString() : 'unknown';
      const blockNumber = logData.blockNumber ? Number(logData.blockNumber) : 0;
      const removed = logData.removed || false;

      // Skip removed (reorg) events
      if (removed) {
        log.debug({
          chainId: this.chainId,
          nftId,
          from,
          to,
          msg: 'Skipping removed (reorg) transfer event',
        });
        continue;
      }

      // Classify the event
      const eventType = classifyTransferEvent(from, to);

      log.info({
        chainId: this.chainId,
        nftId,
        eventType,
        from,
        to,
        blockNumber,
        msg: `NFPM Transfer: ${eventType} nftId=${nftId} block=${blockNumber}`,
      });

      // Publish to RabbitMQ
      this.publishEvent(nftId, eventType, from, to, rawLog).catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          chainId: this.chainId,
          nftId,
          eventType,
          msg: 'Failed to publish NFPM transfer event',
        });
      });
    }
  }

  /**
   * Publish a transfer event to RabbitMQ.
   */
  private async publishEvent(
    nftId: string,
    eventType: NfpmTransferEventType,
    from: string,
    to: string,
    rawPayload: unknown,
  ): Promise<void> {
    const mq = getRabbitMQConnection();

    const event = createNfpmTransferEvent(this.chainId, nftId, eventType, from, to, rawPayload);
    const routingKey = buildNfpmTransferRoutingKey(this.chainId, eventType, nftId);
    const content = serializeNfpmTransferEvent(event);

    await mq.publishNfpmTransferEvent(routingKey, content);
  }

  /**
   * Handle WebSocket errors.
   */
  private handleError(error: Error): void {
    priceLog.wsConnection(log, this.chainId, 'error', {
      batchIndex: this.batchIndex,
      error: error.message,
      type: 'nfpm-transfer',
    });

    this.stopWatchers();
    this.client = null;

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
      type: 'nfpm-transfer',
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
 * Create NFPM Transfer subscription batches for a chain.
 * Splits wallet addresses into batches of MAX_WALLETS_PER_SUBSCRIPTION.
 */
export function createNfpmTransferSubscriptionBatches(
  chainId: SupportedChainId,
  wssUrl: string,
  walletAddresses: string[],
): UniswapV3NfpmTransferSubscriptionBatch[] {
  const batches: UniswapV3NfpmTransferSubscriptionBatch[] = [];

  for (let i = 0; i < walletAddresses.length; i += MAX_WALLETS_PER_SUBSCRIPTION) {
    const batchWallets = walletAddresses.slice(i, i + MAX_WALLETS_PER_SUBSCRIPTION);
    const batchIndex = Math.floor(i / MAX_WALLETS_PER_SUBSCRIPTION);

    batches.push(
      new UniswapV3NfpmTransferSubscriptionBatch(chainId, wssUrl, batchIndex, batchWallets),
    );
  }

  log.info({
    chainId,
    totalWallets: walletAddresses.length,
    batchCount: batches.length,
    msg: `Created ${batches.length} NFPM transfer subscription batches`,
  });

  return batches;
}
