/**
 * Process Close Order Events Rule
 *
 * Subscribes to close order lifecycle events from the onchain-data service
 * and synchronizes the database with on-chain state:
 * - Creates new close orders when OrderRegistered events are observed
 * - Cancels orders when OrderCancelled events are observed
 * - Updates order config when config-change events are observed
 *
 * Events handled (8 total):
 * - OrderRegistered: Create new order or activate existing pending/registering order
 * - OrderCancelled: Cancel order, decrement pool subscription
 * - OrderOperatorUpdated: Update operatorAddress
 * - OrderPayoutUpdated: Update payoutAddress
 * - OrderTriggerTickUpdated: Update triggerTick + recalculate closeOrderHash
 * - OrderValidUntilUpdated: Update validUntil
 * - OrderSlippageUpdated: Update slippageBps
 * - OrderSwapIntentUpdated: Update swapDirection + swapSlippageBps
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma, type PrismaClient } from '@midcurve/database';
import type { OnChainCloseOrder } from '@midcurve/database';
import {
  OnChainCloseOrderService,
  PoolSubscriptionService,
  AutomationLogService,
  UniswapV3PositionService,
  deriveCloseOrderHashFromTick,
  generateOrderTagFromTick,
} from '@midcurve/services';
import type {
  OrderCreatedContext,
  OrderRegisteredContext,
  OrderCancelledContext,
  OrderModifiedContext,
} from '@midcurve/services';
import {
  ContractTriggerMode,
  ContractSwapDirection,
  OnChainOrderStatus,
} from '@midcurve/shared';

/** Transaction client type — subset of PrismaClient usable inside $transaction */
type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
import { BusinessRule } from '../base';
import type {
  AnyCloseOrderEvent,
  TriggerModeString,
  SwapDirectionString,
  OrderRegisteredEvent,
  OrderCancelledEvent,
  OrderOperatorUpdatedEvent,
  OrderPayoutUpdatedEvent,
  OrderTriggerTickUpdatedEvent,
  OrderValidUntilUpdatedEvent,
  OrderSlippageUpdatedEvent,
  OrderSwapIntentUpdatedEvent,
} from './close-order-event-types';

// =============================================================================
// Constants
// =============================================================================

/** Exchange name for close order events from onchain-data service */
const EXCHANGE_CLOSE_ORDER_EVENTS = 'close-order-events';

/** Queue name for this rule's consumption */
const QUEUE_NAME = 'business-logic.process-close-order-events';

/** Routing pattern to subscribe to all close order events */
const ROUTING_PATTERN = 'closer.#';

/** Terminal on-chain statuses (order no longer active on contract) */
const TERMINAL_ON_CHAIN_STATUSES = [
  OnChainOrderStatus.EXECUTED,
  OnChainOrderStatus.CANCELLED,
];

// =============================================================================
// String → Numeric Enum Mapping
// =============================================================================

function parseTriggerMode(s: TriggerModeString): ContractTriggerMode {
  return s === 'LOWER' ? ContractTriggerMode.LOWER : ContractTriggerMode.UPPER;
}

function parseSwapDirection(s: SwapDirectionString): ContractSwapDirection {
  if (s === 'TOKEN0_TO_1') return ContractSwapDirection.TOKEN0_TO_1;
  if (s === 'TOKEN1_TO_0') return ContractSwapDirection.TOKEN1_TO_0;
  return ContractSwapDirection.NONE;
}

// =============================================================================
// Rule Implementation
// =============================================================================

export class ProcessCloseOrderEventsRule extends BusinessRule {
  readonly ruleName = 'process-close-order-events';
  readonly ruleDescription =
    'Processes close order lifecycle events from on-chain data (registration, cancellation, config updates)';

  private consumerTag: string | null = null;
  private orderService: OnChainCloseOrderService;
  private poolSubscriptionService: PoolSubscriptionService;
  private automationLogService: AutomationLogService;
  private positionService: UniswapV3PositionService;

  constructor() {
    super();
    this.orderService = new OnChainCloseOrderService({ prisma });
    this.poolSubscriptionService = new PoolSubscriptionService({ prisma });
    this.automationLogService = new AutomationLogService({ prisma });
    this.positionService = new UniswapV3PositionService({ prisma });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    if (!this.channel) throw new Error('No channel available');

    // Assert exchange (idempotent) — prevents startup failure if onchain-data
    // hasn't created the exchange yet
    await this.channel.assertExchange(EXCHANGE_CLOSE_ORDER_EVENTS, 'topic', {
      durable: true,
      autoDelete: false,
    });

    // Assert queue and bind to close order events exchange
    await this.channel.assertQueue(QUEUE_NAME, {
      durable: true,
      autoDelete: false,
    });
    await this.channel.bindQueue(
      QUEUE_NAME,
      EXCHANGE_CLOSE_ORDER_EVENTS,
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
        exchange: EXCHANGE_CLOSE_ORDER_EVENTS,
        routingPattern: ROUTING_PATTERN,
      },
      'Subscribed to close order events'
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

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    try {
      const event = JSON.parse(msg.content.toString()) as AnyCloseOrderEvent;

      this.logger.debug(
        {
          type: event.type,
          chainId: event.chainId,
          nftId: event.nftId,
          triggerMode: event.triggerMode,
          txHash: event.transactionHash,
        },
        'Processing close order event'
      );

      await this.processEvent(event);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Error processing close order event'
      );
      // Dead-letter the message, don't requeue (prevents infinite retry loops)
      this.channel.nack(msg, false, false);
    }
  }

  private async processEvent(event: AnyCloseOrderEvent): Promise<void> {
    switch (event.type) {
      case 'close-order.uniswapv3.registered':
        return this.handleRegistered(event);
      case 'close-order.uniswapv3.cancelled':
        return this.handleCancelled(event);
      case 'close-order.uniswapv3.operator-updated':
        return this.handleOperatorUpdated(event);
      case 'close-order.uniswapv3.payout-updated':
        return this.handlePayoutUpdated(event);
      case 'close-order.uniswapv3.trigger-tick-updated':
        return this.handleTriggerTickUpdated(event);
      case 'close-order.uniswapv3.valid-until-updated':
        return this.handleValidUntilUpdated(event);
      case 'close-order.uniswapv3.slippage-updated':
        return this.handleSlippageUpdated(event);
      case 'close-order.uniswapv3.swap-intent-updated':
        return this.handleSwapIntentUpdated(event);
      default:
        this.logger.warn(
          { type: (event as AnyCloseOrderEvent).type },
          'Unknown close order event type'
        );
    }
  }

  // ===========================================================================
  // Lookup Helpers
  // ===========================================================================

  /**
   * Finds the close order matching the event's on-chain identifiers.
   * Uses the (chainId, nftId, triggerMode) unique index.
   */
  private async resolveOrder(
    event: AnyCloseOrderEvent,
    tx?: TxClient
  ): Promise<OnChainCloseOrder | null> {
    const triggerMode = parseTriggerMode(event.triggerMode);
    const order = await this.orderService.findByOnChainIdentity(
      event.chainId,
      event.nftId,
      triggerMode,
      tx
    );

    if (!order) {
      this.logger.warn(
        {
          chainId: event.chainId,
          nftId: event.nftId,
          triggerMode: event.triggerMode,
          eventType: event.type,
        },
        'No matching close order found for event'
      );
    }

    return order;
  }

  /**
   * Finds a position by nftId and chainId using Prisma JSON path filtering.
   */
  private async findPositionByNftIdAndChain(
    nftId: string,
    chainId: number,
    tx?: TxClient
  ): Promise<{ id: string; poolId: string } | null> {
    const db = tx ?? prisma;
    const positions = await db.position.findMany({
      where: {
        protocol: 'uniswapv3',
        config: {
          path: ['nftId'],
          equals: parseInt(nftId, 10),
        },
      },
      select: { id: true, poolId: true, config: true },
    });

    const match = positions.find((p) => {
      const config = p.config as { chainId: number };
      return config.chainId === chainId;
    });

    return match ? { id: match.id, poolId: match.poolId } : null;
  }

  /**
   * Builds an orderTag for automation log messages.
   * Uses explicit columns (triggerMode, triggerTick) instead of JSON config parsing.
   */
  private async buildOrderTag(
    order: OnChainCloseOrder,
    tx?: TxClient
  ): Promise<string | null> {
    if (order.triggerTick === null) return null;

    const position = await this.positionService.findById(order.positionId, tx);
    if (!position) {
      this.logger.warn(
        { positionId: order.positionId, orderId: order.id },
        'Cannot build order tag: position not found'
      );
      return null;
    }

    // Derive semantic triggerSide from on-chain triggerMode + isToken0Quote
    // When isToken0Quote, on-chain UPPER = semantic lower (SL), on-chain LOWER = semantic upper (TP)
    const triggerSide: 'lower' | 'upper' = position.isToken0Quote
      ? (order.triggerMode === ContractTriggerMode.UPPER ? 'lower' : 'upper')
      : (order.triggerMode === ContractTriggerMode.LOWER ? 'lower' : 'upper');

    return generateOrderTagFromTick({
      triggerSide,
      triggerTick: order.triggerTick,
      token0IsQuote: position.isToken0Quote,
      token0Decimals: position.pool.token0.decimals,
      token1Decimals: position.pool.token1.decimals,
    });
  }

  /**
   * Builds a UpsertFromOnChainEventInput from a registered event.
   */
  private buildUpsertInput(
    event: OrderRegisteredEvent,
    positionId: string,
  ) {
    const triggerMode = parseTriggerMode(event.triggerMode);
    const { payload } = event;

    return {
      positionId,
      chainId: event.chainId,
      nftId: event.nftId,
      triggerMode,
      contractAddress: event.contractAddress,
      onChainStatus: OnChainOrderStatus.ACTIVE,
      triggerTick: payload.triggerTick,
      slippageBps: payload.slippageBps,
      payoutAddress: payload.payout,
      operatorAddress: payload.operator,
      owner: payload.owner,
      pool: payload.pool,
      validUntil: new Date(Number(payload.validUntil) * 1000),
      swapDirection: parseSwapDirection(payload.swapDirection),
      swapSlippageBps: payload.swapSlippageBps,
      registrationTxHash: event.transactionHash,
      blockNumber: parseInt(event.blockNumber, 10),
      closeOrderHash: deriveCloseOrderHashFromTick(triggerMode, payload.triggerTick),
    };
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * Handles OrderRegistered events.
   *
   * Three scenarios:
   * 1. Order already exists and is ACTIVE → idempotent skip
   * 2. Order already exists but not ACTIVE (pending-from-UI or terminal reactivation)
   *    → upsert overwrites all fields, sets ACTIVE + monitoring
   * 3. No order exists → find position, upsert creates new order
   */
  private async handleRegistered(event: OrderRegisteredEvent): Promise<void> {
    const { chainId, nftId, triggerMode, transactionHash, payload } = event;
    const triggerModeNum = parseTriggerMode(triggerMode);

    // Transaction returns { poolId, isNew, wasTerminal } for post-tx subscription management
    const result = await prisma.$transaction(async (tx) => {
      // Check if order already exists
      const existingOrder = await this.orderService.findByOnChainIdentity(
        chainId,
        nftId,
        triggerModeNum,
        tx
      );

      if (existingOrder) {
        if (existingOrder.onChainStatus === OnChainOrderStatus.ACTIVE) {
          // Already active — idempotent skip
          this.logger.debug(
            { orderId: existingOrder.id },
            'Order already active, skipping registered event'
          );
          return null;
        }

        // Non-ACTIVE order: pending-from-UI or terminal reactivation
        const wasTerminal = TERMINAL_ON_CHAIN_STATUSES.includes(
          existingOrder.onChainStatus as 2 | 3
        );

        // Upsert overwrites all fields, sets ACTIVE + monitoring
        const upsertInput = this.buildUpsertInput(event, existingOrder.positionId);
        const updated = await this.orderService.upsertFromOnChainEvent(upsertInput, tx);

        this.logger.info(
          {
            orderId: updated.id,
            previousStatus: existingOrder.onChainStatus,
            wasTerminal,
          },
          'Existing order activated from on-chain registration'
        );

        // Log ORDER_REGISTERED
        const orderTag = await this.buildOrderTag(updated, tx);
        if (orderTag) {
          await this.automationLogService.logOrderRegistered(
            updated.positionId,
            updated.id,
            {
              orderTag,
              registrationTxHash: transactionHash,
              chainId,
            } satisfies OrderRegisteredContext,
            tx
          );
        }

        // Look up poolId for post-tx subscription management
        const position = await tx.position.findUnique({
          where: { id: existingOrder.positionId },
          select: { poolId: true },
        });

        return {
          poolId: position?.poolId ?? null,
          isNew: false,
          wasTerminal,
        };
      }

      // No existing order — find the position
      const position = await this.findPositionByNftIdAndChain(nftId, chainId, tx);
      if (!position) {
        this.logger.warn(
          { chainId, nftId },
          'No position found for registered close order event, skipping'
        );
        return null;
      }

      // Create the order via upsert
      const upsertInput = this.buildUpsertInput(event, position.id);
      const created = await this.orderService.upsertFromOnChainEvent(upsertInput, tx);

      this.logger.info(
        {
          orderId: created.id,
          positionId: position.id,
          nftId,
          triggerMode,
        },
        'Close order created from on-chain registration'
      );

      // Log ORDER_CREATED
      const orderTag = await this.buildOrderTag(created, tx);
      if (orderTag) {
        await this.automationLogService.logOrderCreated(
          created.positionId,
          created.id,
          {
            orderTag,
            slippageBps: payload.slippageBps,
            chainId,
          } satisfies OrderCreatedContext,
          tx
        );
      }

      return {
        poolId: position.poolId,
        isNew: true,
        wasTerminal: false,
      };
    });

    // Manage pool subscription outside transaction
    if (result && result.poolId) {
      if (result.isNew) {
        await this.poolSubscriptionService.ensureSubscription(result.poolId);
        await this.poolSubscriptionService.incrementOrderCount(result.poolId);
      } else if (result.wasTerminal) {
        // Reactivated terminal order — subscription count was decremented on cancel/execute
        await this.poolSubscriptionService.ensureSubscription(result.poolId);
        await this.poolSubscriptionService.incrementOrderCount(result.poolId);
      }
    }
  }

  /**
   * Handles OrderCancelled events.
   * Cancels the order and decrements the pool subscription order count.
   */
  private async handleCancelled(event: OrderCancelledEvent): Promise<void> {
    const poolId = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      // Skip if already in terminal on-chain state
      if (TERMINAL_ON_CHAIN_STATUSES.includes(order.onChainStatus as 2 | 3)) {
        this.logger.debug(
          { orderId: order.id, onChainStatus: order.onChainStatus },
          'Order already in terminal state, skipping cancel'
        );
        return null;
      }

      // Build order tag before cancel (order still has data)
      const orderTag = await this.buildOrderTag(order, tx);

      await this.orderService.markOnChainCancelled(order.id, tx);

      // Look up position poolId for post-tx subscription update
      const position = await tx.position.findUnique({
        where: { id: order.positionId },
        select: { poolId: true },
      });

      this.logger.info(
        { orderId: order.id },
        'Close order cancelled from on-chain event'
      );

      // Log ORDER_CANCELLED
      if (orderTag) {
        await this.automationLogService.logOrderCancelled(
          order.positionId,
          order.id,
          {
            orderTag,
            reason: 'on-chain cancellation',
            chainId: event.chainId,
          } satisfies OrderCancelledContext,
          tx
        );
      }

      return position?.poolId ?? null;
    });

    // Decrement pool subscription order count outside transaction
    if (poolId) {
      await this.poolSubscriptionService.decrementOrderCount(poolId);
    }
  }

  /**
   * Handles OrderOperatorUpdated events.
   */
  private async handleOperatorUpdated(
    event: OrderOperatorUpdatedEvent
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return;

      await this.orderService.updateOnChainFields(
        order.id,
        { operatorAddress: event.payload.newOperator },
        tx
      );

      this.logger.info(
        { orderId: order.id, newOperator: event.payload.newOperator },
        'Close order operator updated'
      );

      const orderTag = await this.buildOrderTag(order, tx);
      if (orderTag) {
        await this.automationLogService.logOrderModified(
          order.positionId,
          order.id,
          {
            orderTag,
            changes: 'operator address',
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }
    });
  }

  /**
   * Handles OrderPayoutUpdated events.
   */
  private async handlePayoutUpdated(
    event: OrderPayoutUpdatedEvent
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return;

      await this.orderService.updateOnChainFields(
        order.id,
        { payoutAddress: event.payload.newPayout },
        tx
      );

      this.logger.info(
        { orderId: order.id, newPayout: event.payload.newPayout },
        'Close order payout updated'
      );

      const orderTag = await this.buildOrderTag(order, tx);
      if (orderTag) {
        await this.automationLogService.logOrderModified(
          order.positionId,
          order.id,
          {
            orderTag,
            changes: 'payout address',
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }
    });
  }

  /**
   * Handles OrderTriggerTickUpdated events.
   *
   * Updates triggerTick and recalculates closeOrderHash.
   * No more isToken0Quote/sqrtPriceX96 logic — tick is stored directly.
   */
  private async handleTriggerTickUpdated(
    event: OrderTriggerTickUpdatedEvent
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return;

      // Build order tag BEFORE update (captures old trigger price)
      const oldOrderTag = await this.buildOrderTag(order, tx);

      const newTick = event.payload.newTick;
      const newCloseOrderHash = deriveCloseOrderHashFromTick(
        order.triggerMode as ContractTriggerMode,
        newTick
      );

      await this.orderService.updateTriggerTick(
        order.id,
        newTick,
        newCloseOrderHash,
        tx
      );

      this.logger.info(
        {
          orderId: order.id,
          oldTick: event.payload.oldTick,
          newTick,
          newHash: newCloseOrderHash,
        },
        'Close order trigger tick updated'
      );

      if (oldOrderTag) {
        await this.automationLogService.logOrderModified(
          order.positionId,
          order.id,
          {
            orderTag: oldOrderTag,
            changes: 'trigger tick',
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }
    });
  }

  /**
   * Handles OrderValidUntilUpdated events.
   */
  private async handleValidUntilUpdated(
    event: OrderValidUntilUpdatedEvent
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return;

      const newValidUntil = new Date(
        Number(event.payload.newValidUntil) * 1000
      );

      await this.orderService.updateOnChainFields(
        order.id,
        { validUntil: newValidUntil },
        tx
      );

      this.logger.info(
        { orderId: order.id, newValidUntil: newValidUntil.toISOString() },
        'Close order valid-until updated'
      );

      const orderTag = await this.buildOrderTag(order, tx);
      if (orderTag) {
        await this.automationLogService.logOrderModified(
          order.positionId,
          order.id,
          {
            orderTag,
            changes: 'valid-until',
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }
    });
  }

  /**
   * Handles OrderSlippageUpdated events.
   */
  private async handleSlippageUpdated(
    event: OrderSlippageUpdatedEvent
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return;

      await this.orderService.updateOnChainFields(
        order.id,
        { slippageBps: event.payload.newSlippageBps },
        tx
      );

      this.logger.info(
        { orderId: order.id, newSlippageBps: event.payload.newSlippageBps },
        'Close order slippage updated'
      );

      const orderTag = await this.buildOrderTag(order, tx);
      if (orderTag) {
        await this.automationLogService.logOrderModified(
          order.positionId,
          order.id,
          {
            orderTag,
            changes: 'slippage',
            previousSlippageBps: order.slippageBps ?? undefined,
            newSlippageBps: event.payload.newSlippageBps,
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }
    });
  }

  /**
   * Handles OrderSwapIntentUpdated events.
   */
  private async handleSwapIntentUpdated(
    event: OrderSwapIntentUpdatedEvent
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return;

      await this.orderService.updateSwapConfig(
        order.id,
        parseSwapDirection(event.payload.newDirection),
        event.payload.swapSlippageBps,
        tx
      );

      this.logger.info(
        { orderId: order.id, newDirection: event.payload.newDirection },
        'Close order swap intent updated'
      );

      const orderTag = await this.buildOrderTag(order, tx);
      if (orderTag) {
        await this.automationLogService.logOrderModified(
          order.positionId,
          order.id,
          {
            orderTag,
            changes: 'swap intent',
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }
    });
  }
}
