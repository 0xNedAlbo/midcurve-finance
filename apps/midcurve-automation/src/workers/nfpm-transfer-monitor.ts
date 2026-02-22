/**
 * NfpmTransferMonitor
 *
 * Consumes NFPM Transfer events from RabbitMQ and processes them:
 * - MINT (from=0x0): Auto-import position via discover()
 * - BURN (to=0x0): Refresh position to trigger burned state transition
 * - TRANSFER: Add TRANSFER lifecycle ledger event (deltaL=0)
 *
 * Binds a durable queue to the nfpm-transfer-events topic exchange
 * (declared by midcurve-onchain-data).
 */

import { prisma } from '@midcurve/database';
import { UniswapV3LedgerService } from '@midcurve/services';
import type { UniswapV3LedgerEventState } from '@midcurve/shared';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection, type ConsumeMessage } from '../mq/connection-manager';
import { getPositionService } from '../lib/services';

const log = automationLogger.child({ component: 'NfpmTransferMonitor' });

// ============================================================
// Constants
// ============================================================

/** Exchange declared by midcurve-onchain-data */
const EXCHANGE_NFPM_TRANSFERS = 'nfpm-transfer-events';

/** Queue for this consumer */
const QUEUE_NFPM_TRANSFERS = 'automation.nfpm-transfers';

/** Routing pattern: all chains, all event types */
const ROUTING_PATTERN = 'uniswapv3.#';

// ============================================================
// Message Types (mirroring onchain-data's NfpmTransferEventWrapper)
// ============================================================

type NfpmTransferEventType = 'MINT' | 'BURN' | 'TRANSFER';

interface NfpmTransferMessage {
  chainId: number;
  nftId: string;
  eventType: NfpmTransferEventType;
  from: string;
  to: string;
  raw: {
    blockNumber?: string | number;
    transactionHash?: string;
    transactionIndex?: number;
    logIndex?: number;
    blockHash?: string;
  };
  receivedAt: string;
}

// ============================================================
// Status Type
// ============================================================

export interface NfpmTransferMonitorStatus {
  status: 'idle' | 'running' | 'stopped';
  processedTotal: number;
  mintsProcessed: number;
  burnsProcessed: number;
  transfersProcessed: number;
  errorsTotal: number;
  lastProcessedAt: string | null;
}

// ============================================================
// Monitor
// ============================================================

export class NfpmTransferMonitor {
  private consumerTag: string | null = null;
  private status: 'idle' | 'running' | 'stopped' = 'idle';
  private processedTotal = 0;
  private mintsProcessed = 0;
  private burnsProcessed = 0;
  private transfersProcessed = 0;
  private errorsTotal = 0;
  private lastProcessedAt: Date | null = null;

  /**
   * Start consuming NFPM transfer events.
   * Sets up the queue, binds to the exchange, and starts the consumer.
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'NfpmTransferMonitor already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'NfpmTransferMonitor', 'starting');

    const mq = getRabbitMQConnection();
    const channel = await mq.getChannel();

    // Assert exchange exists (idempotent — onchain-data declares it)
    await channel.assertExchange(EXCHANGE_NFPM_TRANSFERS, 'topic', {
      durable: true,
      autoDelete: false,
    });

    // Assert consumer queue
    await channel.assertQueue(QUEUE_NFPM_TRANSFERS, {
      durable: true,
      exclusive: false,
      autoDelete: false,
    });

    // Bind queue to exchange
    await channel.bindQueue(QUEUE_NFPM_TRANSFERS, EXCHANGE_NFPM_TRANSFERS, ROUTING_PATTERN);

    log.info({
      exchange: EXCHANGE_NFPM_TRANSFERS,
      queue: QUEUE_NFPM_TRANSFERS,
      routingPattern: ROUTING_PATTERN,
      msg: 'Queue bound to exchange',
    });

    // Start consumer with prefetch=1 (process one at a time)
    this.consumerTag = await mq.consume(
      QUEUE_NFPM_TRANSFERS,
      async (msg) => this.handleMessage(msg),
      { prefetch: 1 },
    );

    this.status = 'running';
    autoLog.workerLifecycle(log, 'NfpmTransferMonitor', 'started');
  }

  /**
   * Stop consuming.
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'NfpmTransferMonitor', 'stopping');

    if (this.consumerTag) {
      const mq = getRabbitMQConnection();
      await mq.cancelConsumer(this.consumerTag);
      this.consumerTag = null;
    }

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'NfpmTransferMonitor', 'stopped');
  }

  /**
   * Get monitor status.
   */
  getStatus(): NfpmTransferMonitorStatus {
    return {
      status: this.status,
      processedTotal: this.processedTotal,
      mintsProcessed: this.mintsProcessed,
      burnsProcessed: this.burnsProcessed,
      transfersProcessed: this.transfersProcessed,
      errorsTotal: this.errorsTotal,
      lastProcessedAt: this.lastProcessedAt?.toISOString() ?? null,
    };
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Handle an incoming NFPM transfer message.
   */
  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) return;

    const mq = getRabbitMQConnection();

    try {
      const message = JSON.parse(msg.content.toString()) as NfpmTransferMessage;

      log.info({
        chainId: message.chainId,
        nftId: message.nftId,
        eventType: message.eventType,
        from: message.from,
        to: message.to,
        msg: `Processing NFPM ${message.eventType} event`,
      });

      switch (message.eventType) {
        case 'MINT':
          await this.handleMint(message);
          this.mintsProcessed++;
          break;
        case 'BURN':
          await this.handleBurn(message);
          this.burnsProcessed++;
          break;
        case 'TRANSFER':
          await this.handleTransfer(message);
          this.transfersProcessed++;
          break;
        default:
          log.warn({ eventType: (message as NfpmTransferMessage).eventType, msg: 'Unknown event type' });
      }

      this.processedTotal++;
      this.lastProcessedAt = new Date();

      await mq.ack(msg);
    } catch (error) {
      this.errorsTotal++;
      log.error({
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to process NFPM transfer event',
      });

      // Nack and requeue for retry
      await mq.nack(msg, true);
    }
  }

  /**
   * Handle MINT event — log only.
   *
   * Position creation and MINT lifecycle event are handled by the
   * PUT /api/v1/positions/uniswapv3/:chainId/:nftId endpoint, which
   * has the user's quote token choice and the mint transaction hash.
   */
  private async handleMint(message: NfpmTransferMessage): Promise<void> {
    const { chainId, nftId, to } = message;
    log.info({
      chainId,
      nftId,
      to: to.toLowerCase(),
      msg: 'MINT event received — position creation handled by PUT endpoint',
    });
  }

  /**
   * Handle BURN event — refresh position to detect burned state.
   *
   * 1. Look up position by positionHash = "uniswapv3/{chainId}/{nftId}"
   * 2. Call refresh() which detects the burn from on-chain state
   * 3. Add BURN lifecycle event to the ledger
   */
  private async handleBurn(message: NfpmTransferMessage): Promise<void> {
    const { chainId, nftId, from } = message;
    const normalizedFrom = from.toLowerCase();

    const positionService = getPositionService();
    const positionHash = `uniswapv3/${chainId}/${nftId}`;

    // Find position by hash (across all users)
    const position = await prisma.position.findFirst({
      where: { positionHash },
      select: { id: true, userId: true },
    });

    if (!position) {
      log.debug({
        chainId,
        nftId,
        positionHash,
        msg: 'No position found for BURN event, skipping',
      });
      return;
    }

    log.info({
      chainId,
      nftId,
      positionId: position.id,
      msg: 'Refreshing position to detect burned state',
    });

    try {
      // refresh() will detect the burn via on-chain state and transition
      await positionService.refresh(position.id);

      // Add BURN lifecycle event
      await this.addLifecycleEvent(position.id, message, {
        eventType: 'BURN',
        tokenId: BigInt(nftId),
        from: normalizedFrom,
      } as UniswapV3LedgerEventState);

      log.info({
        chainId,
        nftId,
        positionId: position.id,
        msg: 'Position burn detected and processed',
      });
    } catch (error) {
      log.error({
        chainId,
        nftId,
        positionId: position.id,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to process BURN event',
      });
    }
  }

  /**
   * Handle TRANSFER event — add lifecycle ledger event.
   *
   * 1. Look up position by positionHash
   * 2. Add TRANSFER lifecycle event (deltaL=0, no PnL impact)
   */
  private async handleTransfer(message: NfpmTransferMessage): Promise<void> {
    const { chainId, nftId, from, to } = message;
    const normalizedFrom = from.toLowerCase();
    const normalizedTo = to.toLowerCase();

    const positionHash = `uniswapv3/${chainId}/${nftId}`;

    // Find position by hash
    const position = await prisma.position.findFirst({
      where: { positionHash },
      select: { id: true },
    });

    if (!position) {
      // Position might not exist yet if it's being transferred to a tracked wallet.
      // In that case, the incoming transfer to a tracked wallet also triggers a
      // "TRANSFER" event on the incoming subscription. We could auto-import here,
      // but for now we just log and skip.
      log.debug({
        chainId,
        nftId,
        positionHash,
        msg: 'No position found for TRANSFER event, skipping',
      });
      return;
    }

    log.info({
      chainId,
      nftId,
      positionId: position.id,
      from: normalizedFrom,
      to: normalizedTo,
      msg: 'Adding TRANSFER lifecycle event',
    });

    try {
      await this.addLifecycleEvent(position.id, message, {
        eventType: 'TRANSFER',
        tokenId: BigInt(nftId),
        from: normalizedFrom,
        to: normalizedTo,
      } as UniswapV3LedgerEventState);

      log.info({
        chainId,
        nftId,
        positionId: position.id,
        msg: 'TRANSFER lifecycle event added',
      });
    } catch (error) {
      log.error({
        chainId,
        nftId,
        positionId: position.id,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to add TRANSFER lifecycle event',
      });
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Add a lifecycle ledger event to a position.
   * Extracts blockchain metadata from the raw event payload.
   */
  private async addLifecycleEvent(
    positionId: string,
    message: NfpmTransferMessage,
    state: UniswapV3LedgerEventState,
  ): Promise<void> {
    const raw = message.raw ?? {};
    const blockNumber = raw.blockNumber
      ? BigInt(raw.blockNumber)
      : 0n;
    const txHash = raw.transactionHash ?? '0x0';
    const txIndex = raw.transactionIndex ?? 0;
    const logIndex = raw.logIndex ?? 0;
    const blockHash = raw.blockHash ?? '0x0';

    // Use receivedAt as approximate timestamp (avoids extra RPC call)
    const timestamp = message.receivedAt
      ? new Date(message.receivedAt)
      : new Date();

    const ledgerService = new UniswapV3LedgerService(
      { positionId },
    );

    await ledgerService.createLifecycleEvent({
      chainId: message.chainId,
      nftId: BigInt(message.nftId),
      blockNumber,
      txIndex,
      logIndex,
      txHash,
      blockHash,
      timestamp,
      sqrtPriceX96: 0n, // Lifecycle event — no price impact
      state,
    });
  }
}
