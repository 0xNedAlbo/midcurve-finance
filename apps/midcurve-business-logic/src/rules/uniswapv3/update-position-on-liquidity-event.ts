/**
 * Update Position on Liquidity Event Rule
 *
 * When a position liquidity event is received from the onchain-data service,
 * this rule imports the event log and refreshes all matching positions:
 * - Imports raw log to position's ledger events
 * - Refreshes position state (liquidity, fees, PnL)
 *
 * Uses atomic transactions to ensure import + refresh are consistent.
 *
 * Events handled:
 * - IncreaseLiquidity: Position adds liquidity
 * - DecreaseLiquidity: Position removes liquidity
 * - Collect: Position collects fees/principal
 */

import type { ConsumeMessage } from 'amqplib';
import type { PrismaClient } from '@midcurve/database';
import { prisma } from '@midcurve/database';
import {
  UniswapV3PositionService,
  UniswapV3LedgerService,
  UniswapV3PoolPriceService,
  validateRawEvent,
  getDomainEventPublisher,
  type RawLogInput,
  type PositionLiquidityIncreasedPayload,
  type PositionLiquidityDecreasedPayload,
  type PositionFeesCollectedPayload,
  type PositionLiquidityRevertedPayload,
  type DomainEventType,
} from '@midcurve/services';
import { BusinessRule } from '../base';

// =============================================================================
// Constants
// =============================================================================

/** Exchange name for position liquidity events from onchain-data service */
const EXCHANGE_POSITION_LIQUIDITY = 'position-liquidity-events';

/** Queue name for this rule's consumption */
const QUEUE_NAME = 'business-logic.update-position-on-liquidity-event';

/** Routing pattern to subscribe to all UniswapV3 position events */
const ROUTING_PATTERN = 'uniswapv3.#';

/** Map from on-chain event type to domain event type */
const VALID_EVENT_TO_DOMAIN_EVENT: Record<string, DomainEventType> = {
  INCREASE_LIQUIDITY: 'position.liquidity.increased',
  DECREASE_LIQUIDITY: 'position.liquidity.decreased',
  COLLECT: 'position.fees.collected',
};

// =============================================================================
// Types
// =============================================================================

/** Position event types from NFPM contract */
type PositionEventType = 'INCREASE_LIQUIDITY' | 'DECREASE_LIQUIDITY' | 'COLLECT';

/**
 * Raw position event wrapper from onchain-data service.
 * Matches the RawPositionEventWrapper type in midcurve-onchain-data.
 */
interface RawPositionEventWrapper {
  /** Chain ID for routing context */
  chainId: number;
  /** NFT ID (tokenId) for routing context */
  nftId: string;
  /** Event type for consumer discrimination */
  eventType: PositionEventType;
  /** Raw WebSocket payload as-is (viem Log format) */
  raw: unknown;
  /** ISO timestamp when event was received */
  receivedAt: string;
}

// =============================================================================
// Rule Implementation
// =============================================================================

/**
 * Updates positions when liquidity events occur.
 *
 * Subscribes to position liquidity events from the onchain-data service and:
 * 1. Finds all positions matching the nftId and chainId
 * 2. Validates the raw log event
 * 3. Imports the log to the position's ledger
 * 4. Refreshes position state (liquidity, fees, PnL)
 *
 * All operations are atomic within a database transaction.
 */
export class UpdatePositionOnLiquidityEventRule extends BusinessRule {
  readonly ruleName = 'update-position-on-liquidity-event';
  readonly ruleDescription =
    'Imports ledger events and refreshes position state when position liquidity events occur';

  private consumerTag: string | null = null;
  private positionService: UniswapV3PositionService;
  private poolPriceService: UniswapV3PoolPriceService;

  constructor() {
    super();
    this.positionService = new UniswapV3PositionService({ prisma });
    this.poolPriceService = new UniswapV3PoolPriceService({ prisma });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    if (!this.channel) throw new Error('No channel available');

    // Initialize domain event publisher for outbox-based event emission
    getDomainEventPublisher().setChannel(this.channel);

    // Assert queue and bind to position liquidity events exchange
    await this.channel.assertQueue(QUEUE_NAME, {
      durable: true,
      autoDelete: false,
    });
    await this.channel.bindQueue(
      QUEUE_NAME,
      EXCHANGE_POSITION_LIQUIDITY,
      ROUTING_PATTERN
    );
    await this.channel.prefetch(1);

    // Start consuming
    const result = await this.channel.consume(
      QUEUE_NAME,
      (msg) => this.handleMessage(msg),
      { noAck: false }
    );

    this.consumerTag = result.consumerTag;
    this.logger.info(
      {
        queueName: QUEUE_NAME,
        exchange: EXCHANGE_POSITION_LIQUIDITY,
        routingPattern: ROUTING_PATTERN,
      },
      'Subscribed to position liquidity events'
    );
  }

  protected async onShutdown(): Promise<void> {
    if (this.consumerTag && this.channel) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Handle incoming message from RabbitMQ.
   * Parses event, processes it, and acks/nacks accordingly.
   */
  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    try {
      const event = JSON.parse(msg.content.toString()) as RawPositionEventWrapper;
      await this.processEvent(event);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing position liquidity event'
      );
      // Dead-letter the message (don't requeue)
      this.channel.nack(msg, false, false);
    }
  }

  /**
   * Process a position liquidity event.
   * Finds matching positions and updates each one atomically.
   */
  private async processEvent(event: RawPositionEventWrapper): Promise<void> {
    const { chainId, nftId, eventType } = event;

    this.logger.debug(
      { chainId, nftId, eventType },
      'Processing position liquidity event'
    );

    // 1. Find all positions matching nftId
    const positions = await prisma.position.findMany({
      where: {
        protocol: 'uniswapv3',
        config: {
          path: ['nftId'],
          equals: parseInt(nftId, 10),
        },
      },
      include: {
        pool: {
          include: { token0: true, token1: true },
        },
      },
    });

    // 2. Filter by chainId (Prisma can't filter two JSON paths in one query)
    const matchingPositions = positions.filter((p) => {
      const config = p.config as { chainId: number };
      return config.chainId === chainId;
    });

    if (matchingPositions.length === 0) {
      this.logger.debug({ chainId, nftId }, 'No matching positions found');
      return;
    }

    // 3. Convert raw to RawLogInput and extract block number
    const rawLog = event.raw as RawLogInput;
    const blockNumber = this.parseBlockNumber(rawLog.blockNumber);

    // 4. Process each matching position atomically
    for (const positionRow of matchingPositions) {
      try {
        await this.processPositionUpdate(
          positionRow,
          chainId,
          nftId,
          rawLog,
          blockNumber
        );
      } catch (error) {
        this.logger.error(
          {
            positionId: positionRow.id,
            chainId,
            nftId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Error updating position'
        );
        // Continue processing other positions
      }
    }

    this.logger.info(
      { chainId, nftId, eventType, positionCount: matchingPositions.length },
      'Processed position liquidity event'
    );
  }

  /**
   * Process a single position update atomically.
   * Validates the event, imports the log, and refreshes the position.
   */
  private async processPositionUpdate(
    positionRow: { id: string },
    chainId: number,
    nftId: string,
    rawLog: RawLogInput,
    blockNumber: number
  ): Promise<void> {
    // 1. Validate raw event
    const validation = validateRawEvent(chainId, nftId, rawLog);
    if (!validation.valid) {
      this.logger.warn(
        { positionId: positionRow.id, reason: validation.reason },
        'Invalid raw event, skipping'
      );
      return;
    }

    // 2. Load full position domain object via service (handles all type conversions)
    const position = await this.positionService.findById(positionRow.id);
    if (!position) {
      this.logger.warn(
        { positionId: positionRow.id },
        'Position not found, skipping'
      );
      return;
    }

    // 3. Atomic transaction: import log + refresh + emit domain events
    const publisher = getDomainEventPublisher();
    await prisma.$transaction(async (tx) => {
      // Import the log event
      const ledgerService = new UniswapV3LedgerService(
        { positionId: position.id },
        { prisma: tx as unknown as PrismaClient }
      );
      const importResult = await ledgerService.importLogsForPosition(
        position,
        chainId,
        [rawLog],
        this.poolPriceService,
        tx
      );

      // Emit domain events for newly inserted or reverted ledger events
      for (const result of importResult.results) {
        if (result.action === 'inserted') {
          const { eventDetail } = result;
          const domainEventType = VALID_EVENT_TO_DOMAIN_EVENT[eventDetail.validEventType];

          let payload: PositionLiquidityIncreasedPayload | PositionLiquidityDecreasedPayload | PositionFeesCollectedPayload;
          if (eventDetail.validEventType === 'COLLECT') {
            const feeDelta = importResult.aggregates.collectedFeesAfter - importResult.preImportAggregates.collectedFeesAfter;
            payload = {
              positionId: position.id,
              positionHash: position.positionHash,
              poolId: position.pool.id,
              chainId,
              nftId,
              fees0: eventDetail.amount0.toString(),
              fees1: eventDetail.amount1.toString(),
              feesValueInQuote: feeDelta.toString(),
              eventTimestamp: eventDetail.blockTimestamp.toISOString(),
            } satisfies PositionFeesCollectedPayload;
          } else {
            payload = {
              positionId: position.id,
              positionHash: position.positionHash,
              poolId: position.pool.id,
              chainId,
              nftId,
              liquidityDelta: eventDetail.liquidityDelta.toString(),
              liquidityAfter: importResult.aggregates.liquidityAfter.toString(),
              token0Amount: eventDetail.amount0.toString(),
              token1Amount: eventDetail.amount1.toString(),
              eventTimestamp: eventDetail.blockTimestamp.toISOString(),
            } satisfies PositionLiquidityIncreasedPayload;
          }

          await publisher.createAndPublish({
            type: domainEventType,
            entityId: position.id,
            entityType: 'position',
            userId: position.userId,
            payload,
            source: 'business-logic',
          }, tx);
        } else if (result.action === 'removed' && result.deletedCount > 0) {
          await publisher.createAndPublish<PositionLiquidityRevertedPayload>({
            type: 'position.liquidity.reverted',
            entityId: position.id,
            entityType: 'position',
            userId: position.userId,
            payload: {
              positionId: position.id,
              positionHash: position.positionHash,
              chainId,
              nftId,
              blockHash: result.blockHash,
              deletedCount: result.deletedCount,
              revertedAt: new Date().toISOString(),
            },
            source: 'business-logic',
          }, tx);
        }
      }

      // Refresh position state at event's block number
      await this.positionService.refresh(position.id, blockNumber, tx);
    });

    this.logger.debug(
      { positionId: positionRow.id, blockNumber },
      'Position updated successfully'
    );
  }

  /**
   * Parse block number from various formats (string hex, string decimal, bigint).
   */
  private parseBlockNumber(blockNumber: string | bigint): number {
    if (typeof blockNumber === 'bigint') {
      return Number(blockNumber);
    }
    if (blockNumber.startsWith('0x')) {
      return parseInt(blockNumber, 16);
    }
    return parseInt(blockNumber, 10);
  }
}
