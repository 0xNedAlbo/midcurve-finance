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
 * - OrderOperatorUpdated: Update config.operatorAddress
 * - OrderPayoutUpdated: Update config.payoutAddress
 * - OrderTriggerTickUpdated: Update config trigger price + recalculate closeOrderHash
 * - OrderValidUntilUpdated: Update config.validUntil
 * - OrderSlippageUpdated: Update config.slippageBps
 * - OrderSwapIntentUpdated: Update config.swapConfig
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma, type PrismaClient } from '@midcurve/database';
import {
  CloseOrderService,
  PoolSubscriptionService,
  deriveCloseOrderHash,
} from '@midcurve/services';
import {
  tickToSqrtRatioX96,
  type CloseOrderInterface,
  type TriggerMode,
} from '@midcurve/shared';

/** Transaction client type — subset of PrismaClient usable inside $transaction */
type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
import { BusinessRule } from '../base';
import type {
  AnyCloseOrderEvent,
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

/** Terminal close order statuses */
const TERMINAL_STATUSES = ['executed', 'cancelled', 'expired', 'failed'];

// =============================================================================
// Rule Implementation
// =============================================================================

export class ProcessCloseOrderEventsRule extends BusinessRule {
  readonly ruleName = 'process-close-order-events';
  readonly ruleDescription =
    'Processes close order lifecycle events from on-chain data (registration, cancellation, config updates)';

  private consumerTag: string | null = null;
  private closeOrderService: CloseOrderService;
  private poolSubscriptionService: PoolSubscriptionService;

  constructor() {
    super();
    this.closeOrderService = new CloseOrderService({ prisma });
    this.poolSubscriptionService = new PoolSubscriptionService({ prisma });
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
   * Returns null if no matching order exists in the database.
   */
  private async resolveOrder(
    event: AnyCloseOrderEvent,
    tx?: TxClient
  ): Promise<CloseOrderInterface | null> {
    const order = await this.closeOrderService.findByNftIdAndTriggerMode(
      event.nftId,
      event.triggerMode as TriggerMode,
      event.chainId,
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
   * Same pattern as UpdatePositionOnLiquidityEventRule.
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

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * Handles OrderRegistered events.
   *
   * Three scenarios:
   * 1. Order already exists in pending/registering → activate it
   * 2. Order already exists in active → idempotent skip
   * 3. No order exists → create from on-chain event (if position is tracked)
   */
  private async handleRegistered(event: OrderRegisteredEvent): Promise<void> {
    const { chainId, nftId, triggerMode, contractAddress, transactionHash, blockNumber, payload } =
      event;

    // Transaction returns poolId if a new order was created (for post-tx subscription update)
    const createdForPoolId = await prisma.$transaction(async (tx) => {
      // Check if order already exists
      const existingOrder = await this.closeOrderService.findByNftIdAndTriggerMode(
        nftId,
        triggerMode as TriggerMode,
        chainId,
        tx
      );

      if (existingOrder) {
        if (
          existingOrder.status === 'pending' ||
          existingOrder.status === 'registering'
        ) {
          // Order was created by UI/API flow — activate it
          await this.closeOrderService.markRegistered(existingOrder.id, {
            closeId: 0,
            registrationTxHash: transactionHash,
          }, tx);
          this.logger.info(
            { orderId: existingOrder.id, status: existingOrder.status },
            'Existing order activated from on-chain registration'
          );
        } else if (existingOrder.status === 'active') {
          // Already active — idempotent skip
          this.logger.debug(
            { orderId: existingOrder.id },
            'Order already active, skipping registered event'
          );
        } else {
          this.logger.warn(
            { orderId: existingOrder.id, status: existingOrder.status },
            'Registered event for order in unexpected state'
          );
        }
        return null;
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

      // Create the order from on-chain event data
      const created = await this.closeOrderService.createFromOnChainEvent({
        positionId: position.id,
        automationContractConfig: {
          chainId,
          contractAddress,
          positionManager: '',
        },
        nftId,
        poolAddress: payload.pool,
        triggerMode: triggerMode as TriggerMode,
        triggerTick: payload.triggerTick,
        owner: payload.owner,
        operator: payload.operator,
        payout: payload.payout,
        validUntil: payload.validUntil,
        slippageBps: payload.slippageBps,
        registrationTxHash: transactionHash,
        blockNumber,
      }, tx);

      this.logger.info(
        {
          orderId: created.id,
          positionId: position.id,
          nftId,
          triggerMode,
        },
        'Close order created from on-chain registration'
      );

      return position.poolId;
    });

    // Manage pool subscription outside transaction (PoolSubscriptionService is not tx-aware)
    if (createdForPoolId) {
      await this.poolSubscriptionService.ensureSubscription(createdForPoolId);
      await this.poolSubscriptionService.incrementOrderCount(createdForPoolId);
    }
  }

  /**
   * Handles OrderCancelled events.
   * Cancels the order and decrements the pool subscription order count.
   */
  private async handleCancelled(event: OrderCancelledEvent): Promise<void> {
    // Cancel order inside transaction, pool subscription outside
    const poolId = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      // Skip if already in terminal state
      if (TERMINAL_STATUSES.includes(order.status)) {
        this.logger.debug(
          { orderId: order.id, status: order.status },
          'Order already in terminal state, skipping cancel'
        );
        return null;
      }

      await this.closeOrderService.cancel(order.id, tx);

      // Look up position poolId for post-tx subscription update
      const position = await tx.position.findUnique({
        where: { id: order.positionId },
        select: { poolId: true },
      });

      this.logger.info(
        { orderId: order.id },
        'Close order cancelled from on-chain event'
      );

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

      await this.closeOrderService.updateConfigField(order.id, {
        operatorAddress: event.payload.newOperator,
      }, undefined, tx);

      this.logger.info(
        { orderId: order.id, newOperator: event.payload.newOperator },
        'Close order operator updated'
      );
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

      await this.closeOrderService.updateConfigField(order.id, {
        payoutAddress: event.payload.newPayout,
      }, undefined, tx);

      this.logger.info(
        { orderId: order.id, newPayout: event.payload.newPayout },
        'Close order payout updated'
      );
    });
  }

  /**
   * Handles OrderTriggerTickUpdated events.
   *
   * Special: changing the trigger tick changes the sqrtPriceX96 threshold
   * and the closeOrderHash (which is part of the unique constraint).
   */
  private async handleTriggerTickUpdated(
    event: OrderTriggerTickUpdatedEvent
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return;

      const triggerMode = event.triggerMode as TriggerMode;
      const newTick = event.payload.newTick;
      const newSqrtPriceX96 = BigInt(
        tickToSqrtRatioX96(newTick).toString()
      );
      const newCloseOrderHash = deriveCloseOrderHash(
        triggerMode,
        newSqrtPriceX96
      );

      // Update the appropriate threshold based on trigger mode
      const updates: Record<string, unknown> =
        triggerMode === 'LOWER'
          ? { sqrtPriceX96Lower: newSqrtPriceX96.toString() }
          : { sqrtPriceX96Upper: newSqrtPriceX96.toString() };

      await this.closeOrderService.updateConfigField(
        order.id,
        updates,
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
      ).toISOString();

      await this.closeOrderService.updateConfigField(order.id, {
        validUntil: newValidUntil,
      }, undefined, tx);

      this.logger.info(
        { orderId: order.id, newValidUntil },
        'Close order valid-until updated'
      );
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

      await this.closeOrderService.updateConfigField(order.id, {
        slippageBps: event.payload.newSlippageBps,
      }, undefined, tx);

      this.logger.info(
        { orderId: order.id, newSlippageBps: event.payload.newSlippageBps },
        'Close order slippage updated'
      );
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

      await this.closeOrderService.updateSwapConfig(
        order.id,
        event.payload.newDirection,
        tx
      );

      this.logger.info(
        { orderId: order.id, newDirection: event.payload.newDirection },
        'Close order swap intent updated'
      );
    });
  }
}
