/**
 * Process Close Order Events Rule
 *
 * Subscribes to close order lifecycle events from the onchain-data service
 * and synchronizes the database with on-chain state.
 *
 * DB lifecycle driven by on-chain events:
 * - OrderRegistered → INSERT new order (automationState=monitoring)
 * - OrderCancelled → DELETE order from DB
 * - OrderExecuted → UPDATE automationState=executed
 * - Re-registration at same slot → DELETE old + INSERT new
 *
 * Config-change events (9 total):
 * - OrderOperatorUpdated: Update operatorAddress
 * - OrderPayoutUpdated: Update payoutAddress
 * - OrderTriggerTickUpdated: Update triggerTick + recalculate closeOrderHash
 * - OrderValidUntilUpdated: Update validUntil
 * - OrderSlippageUpdated: Update slippageBps
 * - OrderSwapIntentUpdated: Update swapDirection + swapSlippageBps
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma, type PrismaClient } from '@midcurve/database';
import type { CloseOrder } from '@midcurve/database';
import {
  CloseOrderService,
  AutomationSubscriptionService,
  AutomationLogService,
  UniswapV3PositionService,
  deriveCloseOrderHashFromTick,
  generateOrderTagFromTick,
  getDomainEventPublisher,
  createDomainEvent,
} from '@midcurve/services';
import type {
  OrderCreatedContext,
  OrderRegisteredContext,
  OrderExecutedContext,
  OrderCancelledContext,
  OrderModifiedContext,
  CloseOrderRegisteredPayload,
  CloseOrderCancelledPayload,
  CloseOrderExecutedPayload,
  CloseOrderModifiedPayload,
} from '@midcurve/services';
import {
  ContractTriggerMode,
  ContractSwapDirection,
  createUniswapV3OrderIdentityHash,
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
  OrderExecutedEvent,
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

/** Terminal automation states — order lifecycle is complete */
const TERMINAL_AUTOMATION_STATES = ['executed', 'failed'];

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
    'Processes close order lifecycle events from on-chain data (registration, cancellation, execution, config updates)';

  private consumerTag: string | null = null;
  private orderService: CloseOrderService;
  private automationSubscriptionService: AutomationSubscriptionService;
  private automationLogService: AutomationLogService;
  private positionService: UniswapV3PositionService;

  constructor() {
    super();
    this.orderService = new CloseOrderService({ prisma });
    this.automationSubscriptionService = new AutomationSubscriptionService({ prisma });
    this.automationLogService = new AutomationLogService({ prisma });
    this.positionService = new UniswapV3PositionService({ prisma });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    if (!this.channel) throw new Error('No channel available');

    // Set channel on domain event publisher for direct publishing
    getDomainEventPublisher().setChannel(this.channel);

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
      case 'close-order.uniswapv3.executed':
        return this.handleExecuted(event);
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
   * Uses the orderIdentityHash unique index.
   */
  private async resolveOrder(
    event: AnyCloseOrderEvent,
    tx?: TxClient
  ): Promise<CloseOrder | null> {
    const triggerMode = parseTriggerMode(event.triggerMode);
    const orderIdentityHash = createUniswapV3OrderIdentityHash(
      event.chainId,
      event.nftId,
      triggerMode
    );
    const order = await this.orderService.findByOrderIdentityHash(
      orderIdentityHash,
      tx
    );

    if (!order) {
      this.logger.warn(
        {
          chainId: event.chainId,
          nftId: event.nftId,
          triggerMode: event.triggerMode,
          orderIdentityHash,
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
   * Extracts triggerMode from config JSON and triggerTick from state JSON.
   */
  private async buildOrderTag(
    order: CloseOrder,
    tx?: TxClient
  ): Promise<string | null> {
    const config = (order.config ?? {}) as Record<string, unknown>;
    const state = (order.state ?? {}) as Record<string, unknown>;
    const triggerTick = state.triggerTick as number | null | undefined;
    const triggerMode = config.triggerMode as number;

    if (triggerTick === null || triggerTick === undefined) return null;

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
      ? (triggerMode === ContractTriggerMode.UPPER ? 'lower' : 'upper')
      : (triggerMode === ContractTriggerMode.LOWER ? 'lower' : 'upper');

    return generateOrderTagFromTick({
      triggerSide,
      triggerTick,
      token0IsQuote: position.isToken0Quote,
      token0Decimals: position.pool.token0.decimals,
      token1Decimals: position.pool.token1.decimals,
    });
  }

  /**
   * Builds a CreateCloseOrderInput from a registered event.
   * Packs protocol-specific data into config/state JSON.
   */
  private buildCreateInput(
    event: OrderRegisteredEvent,
    positionId: string,
  ) {
    const triggerMode = parseTriggerMode(event.triggerMode);
    const { payload } = event;

    const orderIdentityHash = createUniswapV3OrderIdentityHash(
      event.chainId,
      event.nftId,
      triggerMode
    );

    return {
      protocol: 'uniswapv3' as const,
      positionId,
      orderIdentityHash,
      closeOrderHash: deriveCloseOrderHashFromTick(triggerMode, payload.triggerTick),
      config: {
        chainId: event.chainId,
        nftId: event.nftId,
        triggerMode,
        contractAddress: event.contractAddress,
      },
      state: {
        triggerTick: payload.triggerTick,
        slippageBps: payload.slippageBps,
        payoutAddress: payload.payout,
        operatorAddress: payload.operator,
        owner: payload.owner,
        pool: payload.pool,
        validUntil: new Date(Number(payload.validUntil) * 1000).toISOString(),
        swapDirection: parseSwapDirection(payload.swapDirection),
        swapSlippageBps: payload.swapSlippageBps,
        registrationTxHash: event.transactionHash,
        registeredAt: new Date().toISOString(),
        lastSyncBlock: parseInt(event.blockNumber, 10),
      },
    };
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * Handles OrderRegistered events.
   *
   * DB lifecycle: on-chain registration → INSERT into DB.
   *
   * Three scenarios:
   * 1. Order already exists with automationState=monitoring → idempotent skip
   * 2. Order already exists (terminal or stale) → DELETE old, INSERT new (re-registration)
   * 3. No order exists → find position, INSERT new order
   */
  private async handleRegistered(event: OrderRegisteredEvent): Promise<void> {
    const { chainId, nftId, triggerMode, transactionHash, payload } = event;
    const triggerModeNum = parseTriggerMode(triggerMode);

    const orderIdentityHash = createUniswapV3OrderIdentityHash(
      chainId,
      nftId,
      triggerModeNum
    );

    const result = await prisma.$transaction(async (tx) => {
      // Check if order already exists at this identity slot
      const existingOrder = await this.orderService.findByOrderIdentityHash(
        orderIdentityHash,
        tx
      );

      if (existingOrder) {
        if (existingOrder.automationState === 'monitoring') {
          // Already monitoring — idempotent skip
          this.logger.debug(
            { orderId: existingOrder.id },
            'Order already monitoring, skipping registered event'
          );
          return null;
        }

        // Stale or terminal order at this slot — delete and re-create
        const wasTerminal = TERMINAL_AUTOMATION_STATES.includes(existingOrder.automationState);

        await this.orderService.delete(existingOrder.id, tx);

        this.logger.info(
          {
            deletedOrderId: existingOrder.id,
            previousState: existingOrder.automationState,
            wasTerminal,
          },
          'Deleted existing order for re-registration'
        );
      }

      // Find the position for this nftId + chainId
      const position = existingOrder
        ? await tx.position.findUnique({
            where: { id: existingOrder.positionId },
            select: { id: true, poolId: true, pool: { select: { config: true } } },
          })
        : await this.findPositionByNftIdAndChain(nftId, chainId, tx)
          .then(async (p) => {
            if (!p) return null;
            const pool = await tx.pool.findUnique({
              where: { id: p.poolId },
              select: { config: true },
            });
            return { id: p.id, poolId: p.poolId, pool };
          });

      if (!position) {
        this.logger.warn(
          { chainId, nftId },
          'No position found for registered close order event, skipping'
        );
        return null;
      }

      // INSERT new order
      const createInput = this.buildCreateInput(event, position.id);
      const created = await this.orderService.create(createInput, tx);

      const isNew = !existingOrder;

      this.logger.info(
        {
          orderId: created.id,
          positionId: position.id,
          nftId,
          triggerMode,
          isNew,
        },
        isNew
          ? 'Close order created from on-chain registration'
          : 'Close order re-created from on-chain re-registration'
      );

      // Log appropriate event
      const orderTag = await this.buildOrderTag(created, tx);
      if (orderTag && isNew) {
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
      } else if (orderTag) {
        await this.automationLogService.logOrderRegistered(
          created.positionId,
          created.id,
          {
            orderTag,
            registrationTxHash: transactionHash,
            chainId,
          } satisfies OrderRegisteredContext,
          tx
        );
      }

      const poolConfig = position.pool?.config as Record<string, unknown> | null;
      const poolAddress = (poolConfig?.address as string | undefined)?.toLowerCase();

      return {
        orderId: created.id,
        positionId: position.id,
        poolId: position.poolId,
        poolAddress: poolAddress ?? null,
        isNew,
      };
    });

    // Ensure pool subscription outside transaction
    if (result) {
      const poolAddress = result.poolAddress ?? payload.pool;
      if (poolAddress) {
        await this.automationSubscriptionService.ensurePoolSubscription(chainId, poolAddress);
      }
    }

    // Publish close-order.registered domain event (direct, best-effort)
    if (result) {
      this.publishDomainEvent<CloseOrderRegisteredPayload>('close-order.registered', {
        entityId: result.orderId,
        payload: {
          orderId: result.orderId,
          positionId: result.positionId,
          chainId,
          registrationTxHash: transactionHash,
          closeId: nftId,
          registeredAt: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Handles OrderCancelled events.
   * DB lifecycle: on-chain cancellation → DELETE from DB.
   * Removes the pool subscription if no more monitoring orders reference that pool.
   */
  private async handleCancelled(event: OrderCancelledEvent): Promise<void> {
    const cancelResult = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      const previousState = order.automationState;

      // Build order tag before delete (order still has data)
      const orderTag = await this.buildOrderTag(order, tx);

      // Look up position poolId for post-tx subscription update
      const position = await tx.position.findUnique({
        where: { id: order.positionId },
        select: { poolId: true },
      });

      // Log ORDER_CANCELLED before deleting (needs order.id reference)
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

      // DELETE the order from DB
      await this.orderService.delete(order.id, tx);

      this.logger.info(
        { orderId: order.id, previousState },
        'Close order deleted from on-chain cancellation'
      );

      return {
        orderId: order.id,
        positionId: order.positionId,
        previousState,
        poolId: position?.poolId ?? null,
      };
    });

    // Remove pool subscription if no more monitoring orders
    if (cancelResult?.poolId) {
      await this.automationSubscriptionService.removePoolSubscriptionIfUnused(cancelResult.poolId);
    }

    // Publish close-order.cancelled domain event (direct, best-effort)
    if (cancelResult) {
      this.publishDomainEvent<CloseOrderCancelledPayload>('close-order.cancelled', {
        entityId: cancelResult.orderId,
        payload: {
          orderId: cancelResult.orderId,
          positionId: cancelResult.positionId,
          reason: 'on_chain',
          previousStatus: cancelResult.previousState,
          cancelledAt: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Handles OrderExecuted events.
   * DB lifecycle: on-chain execution → UPDATE automationState=executed.
   * Also stores execution data in state JSON.
   */
  private async handleExecuted(event: OrderExecutedEvent): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      // Skip if already in terminal state (idempotent)
      if (TERMINAL_AUTOMATION_STATES.includes(order.automationState)) {
        this.logger.debug(
          { orderId: order.id, automationState: order.automationState },
          'Order already in terminal state, skipping executed event'
        );
        return null;
      }

      // Mark as executed
      await this.orderService.markExecuted(order.id, tx);

      // Store execution data in order state
      await this.orderService.mergeState(
        order.id,
        {
          executionTick: event.payload.executionTick,
          amount0Out: event.payload.amount0Out,
          amount1Out: event.payload.amount1Out,
          executionTxHash: event.transactionHash,
          executedAt: new Date().toISOString(),
        },
        tx
      );

      this.logger.info(
        {
          orderId: order.id,
          executionTick: event.payload.executionTick,
          txHash: event.transactionHash,
        },
        'Close order marked as executed'
      );

      // Log ORDER_EXECUTED
      const orderTag = await this.buildOrderTag(order, tx);
      if (orderTag) {
        await this.automationLogService.logOrderExecuted(
          order.positionId,
          order.id,
          {
            orderTag,
            chainId: event.chainId,
            txHash: event.transactionHash,
            amount0Out: event.payload.amount0Out,
            amount1Out: event.payload.amount1Out,
            executionFeeBps: 0,
          } satisfies OrderExecutedContext,
          tx
        );
      }

      // Look up position poolId for post-tx subscription update
      const position = await tx.position.findUnique({
        where: { id: order.positionId },
        select: { poolId: true },
      });

      return {
        orderId: order.id,
        positionId: order.positionId,
        poolId: position?.poolId ?? null,
      };
    });

    // Remove pool subscription if no more monitoring orders
    if (result?.poolId) {
      await this.automationSubscriptionService.removePoolSubscriptionIfUnused(result.poolId);
    }

    // Publish close-order.executed domain event (direct, best-effort)
    if (result) {
      this.publishDomainEvent<CloseOrderExecutedPayload>('close-order.executed', {
        entityId: result.orderId,
        payload: {
          orderId: result.orderId,
          positionId: result.positionId,
          chainId: event.chainId,
          executionTxHash: event.transactionHash,
          amount0Out: event.payload.amount0Out,
          amount1Out: event.payload.amount1Out,
          executionFeeBps: 0,
          executedAt: new Date().toISOString(),
        },
      });
    }
  }

  // ===========================================================================
  // Domain Event Publishing Helpers
  // ===========================================================================

  /**
   * Publishes a domain event (best-effort, fire-and-forget).
   * Failures are logged but do not affect the main processing flow.
   */
  private publishDomainEvent<TPayload>(
    type: 'close-order.registered' | 'close-order.cancelled' | 'close-order.executed' | 'close-order.modified',
    opts: { entityId: string; payload: TPayload }
  ): void {
    const event = createDomainEvent<TPayload>({
      type,
      entityType: 'order',
      entityId: opts.entityId,
      payload: opts.payload,
      source: 'business-logic',
    });
    getDomainEventPublisher().publishDirect(event).catch((err) => {
      this.logger.warn(
        { error: err instanceof Error ? err.message : String(err), eventType: type },
        `Failed to publish ${type} domain event (non-critical)`
      );
    });
  }

  /**
   * Publishes a close-order.modified domain event for config change handlers.
   */
  private publishModifiedEvent(
    orderId: string,
    positionId: string,
    chainId: number,
    modifiedFields: string[]
  ): void {
    this.publishDomainEvent<CloseOrderModifiedPayload>('close-order.modified', {
      entityId: orderId,
      payload: {
        orderId,
        positionId,
        chainId,
        modifiedFields,
        modifiedAt: new Date().toISOString(),
      },
    });
  }

  // ===========================================================================
  // Config Change Event Handlers
  // ===========================================================================

  /**
   * Handles OrderOperatorUpdated events.
   */
  private async handleOperatorUpdated(
    event: OrderOperatorUpdatedEvent
  ): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      await this.orderService.mergeState(
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

      return { orderId: order.id, positionId: order.positionId };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, event.chainId, ['operatorAddress']);
    }
  }

  /**
   * Handles OrderPayoutUpdated events.
   */
  private async handlePayoutUpdated(
    event: OrderPayoutUpdatedEvent
  ): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      await this.orderService.mergeState(
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

      return { orderId: order.id, positionId: order.positionId };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, event.chainId, ['payoutAddress']);
    }
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
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      // Build order tag BEFORE update (captures old trigger price)
      const oldOrderTag = await this.buildOrderTag(order, tx);

      const orderConfig = (order.config ?? {}) as Record<string, unknown>;
      const triggerMode = orderConfig.triggerMode as number;
      const newTick = event.payload.newTick;
      const newCloseOrderHash = deriveCloseOrderHashFromTick(
        triggerMode as ContractTriggerMode,
        newTick
      );

      await this.orderService.updateCloseOrderHash(
        order.id,
        newCloseOrderHash,
        { triggerTick: newTick },
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

      return { orderId: order.id, positionId: order.positionId };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, event.chainId, ['triggerTick']);
    }
  }

  /**
   * Handles OrderValidUntilUpdated events.
   */
  private async handleValidUntilUpdated(
    event: OrderValidUntilUpdatedEvent
  ): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      const newValidUntil = new Date(
        Number(event.payload.newValidUntil) * 1000
      );

      await this.orderService.mergeState(
        order.id,
        { validUntil: newValidUntil.toISOString() },
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

      return { orderId: order.id, positionId: order.positionId };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, event.chainId, ['validUntil']);
    }
  }

  /**
   * Handles OrderSlippageUpdated events.
   */
  private async handleSlippageUpdated(
    event: OrderSlippageUpdatedEvent
  ): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      const orderState = (order.state ?? {}) as Record<string, unknown>;
      const previousSlippageBps = orderState.slippageBps as number | null | undefined;

      await this.orderService.mergeState(
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
            previousSlippageBps: previousSlippageBps ?? undefined,
            newSlippageBps: event.payload.newSlippageBps,
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }

      return { orderId: order.id, positionId: order.positionId };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, event.chainId, ['slippageBps']);
    }
  }

  /**
   * Handles OrderSwapIntentUpdated events.
   */
  private async handleSwapIntentUpdated(
    event: OrderSwapIntentUpdatedEvent
  ): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      await this.orderService.mergeState(
        order.id,
        {
          swapDirection: parseSwapDirection(event.payload.newDirection),
          swapSlippageBps: event.payload.swapSlippageBps,
        },
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

      return { orderId: order.id, positionId: order.positionId };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, event.chainId, ['swapDirection', 'swapSlippageBps']);
    }
  }
}
