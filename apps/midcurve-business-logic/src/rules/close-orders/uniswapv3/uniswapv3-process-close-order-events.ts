/**
 * UniswapV3 Process Close Order Events Rule
 *
 * Subscribes to UniswapV3 (NFT) and UniswapV3-Vault close order lifecycle events
 * from the onchain-data service and synchronizes the database with on-chain state.
 *
 * Both protocol variants run through the same handlers. What differs is only the
 * order identity and the position lookup:
 * - NFT:   identity "uniswapv3/{chainId}/{nftId}/{triggerMode}", position by nftId
 * - Vault: identity "uniswapv3-vault/{chainId}/{vault}/{owner}/{triggerMode}",
 *          position by vault address + owner address (a vault is an ERC-20, so
 *          several owners can hold their own orders on the same vault)
 *
 * DB lifecycle driven by on-chain events:
 * - OrderRegistered → ensure the identity slot holds this order (upsert)
 * - OrderCancelled → DELETE order from DB
 * - OrderExecuted → DELETE order from DB (execution data preserved in AutomationLog)
 * - Re-registration at same slot → DELETE old + INSERT new
 *
 * Config-change events:
 * - OrderOperatorUpdated: Update operatorAddress
 * - OrderPayoutUpdated: Update payoutAddress
 * - OrderTriggerTickUpdated: Update triggerTick + recalculate closeOrderHash
 * - OrderValidUntilUpdated: Update validUntil
 * - OrderSlippageUpdated: Update slippageBps
 * - OrderSwapIntentUpdated: Update swapDirection + swapSlippageBps
 * - OrderSharesUpdated (vault only): Update shares
 *
 * Any config-change event on a failed order resets it to monitoring,
 * allowing the user to reactivate failed orders by updating any field.
 *
 * Message disposition — the two cases must stay distinguishable:
 * - Understood but not ours (no matching position, no matching order): logged at
 *   info/warn and acked. For a vault this is the normal case, since anyone can
 *   hold shares and register an order.
 * - Cannot be interpreted (unknown event type, missing identifiers, ambiguous
 *   position): logged at error and dead-lettered to the DLQ.
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma, type PrismaClient } from '@midcurve/database';
import type { CloseOrder } from '@midcurve/database';
import {
  UniswapV3CloseOrderService,
  AutomationSubscriptionService,
  AutomationLogService,
  UniswapV3PositionService,
  UniswapV3VaultPositionService,
  createCloseOrderIdentityHash,
  deriveCloseOrderHashFromTick,
  generateOrderTagFromTick,
  getDomainEventPublisher,
  createDomainEvent,
  EXCHANGE_CLOSE_ORDER_EVENTS,
  EXCHANGE_CLOSE_ORDER_EVENTS_DLX,
  CLOSE_ORDER_DLQ_MESSAGE_TTL_MS,
} from '@midcurve/services';
import type {
  OrderCreatedContext,
  OrderRegisteredContext,
  OrderExecutedContext,
  OrderCancelledContext,
  OrderModifiedContext,
  CloseOrderLifecyclePayload,
  CloseOrderCancelledPayload,
  CloseOrderExecutedPayload,
} from '@midcurve/services';
import {
  ContractTriggerMode,
  ContractSwapDirection,
  normalizeAddress,
} from '@midcurve/shared';

/** Transaction client type — subset of PrismaClient usable inside $transaction */
type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
import { BusinessRule } from '../../base';
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
  VaultOrderRegisteredEvent,
  VaultOrderCancelledEvent,
  VaultOrderExecutedEvent,
  VaultOrderOperatorUpdatedEvent,
  VaultOrderPayoutUpdatedEvent,
  VaultOrderTriggerTickUpdatedEvent,
  VaultOrderValidUntilUpdatedEvent,
  VaultOrderSlippageUpdatedEvent,
  VaultOrderSwapIntentUpdatedEvent,
  VaultOrderSharesUpdatedEvent,
} from './close-order-event-types';

// =============================================================================
// Constants
// =============================================================================

/**
 * Queue name for this rule's consumption.
 *
 * v2: the v1 queue was declared without a dead-letter exchange, so nacked
 * messages were dropped. Queue arguments are immutable in RabbitMQ, so adding
 * the DLX means declaring a new queue and letting the old one drain.
 */
const QUEUE_NAME = 'business-logic.uniswapv3-process-close-order-events.v2';

/** Dead-letter queue for messages this rule cannot interpret */
const DLQ_NAME = 'business-logic.uniswapv3-process-close-order-events.dlq';

/** Routing pattern for UniswapV3 NFT close order events (4 segments: closer.chainId.nftId.triggerMode) */
const UNISWAPV3_ROUTING_PATTERN = 'closer.*.*.*';

/** Routing pattern for UniswapV3 Vault close order events (5 segments: closer.vault.chainId.vaultAddress.triggerMode) */
const UNISWAPV3_VAULT_ROUTING_PATTERN = 'closer.vault.*.*.*';

// =============================================================================
// Event Type Unions (NFT + vault variant of the same lifecycle event)
// =============================================================================

type RegisteredEvent = OrderRegisteredEvent | VaultOrderRegisteredEvent;
type CancelledEvent = OrderCancelledEvent | VaultOrderCancelledEvent;
type ExecutedEvent = OrderExecutedEvent | VaultOrderExecutedEvent;
type OperatorUpdatedEvent = OrderOperatorUpdatedEvent | VaultOrderOperatorUpdatedEvent;
type PayoutUpdatedEvent = OrderPayoutUpdatedEvent | VaultOrderPayoutUpdatedEvent;
type TriggerTickUpdatedEvent =
  | OrderTriggerTickUpdatedEvent
  | VaultOrderTriggerTickUpdatedEvent;
type ValidUntilUpdatedEvent =
  | OrderValidUntilUpdatedEvent
  | VaultOrderValidUntilUpdatedEvent;
type SlippageUpdatedEvent = OrderSlippageUpdatedEvent | VaultOrderSlippageUpdatedEvent;
type SwapIntentUpdatedEvent =
  | OrderSwapIntentUpdatedEvent
  | VaultOrderSwapIntentUpdatedEvent;

/**
 * Thrown for messages this rule cannot interpret. Dead-lettered, never acked —
 * as opposed to events that are understood but don't concern us.
 */
class UnroutableCloseOrderEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnroutableCloseOrderEventError';
  }
}

// =============================================================================
// String → Numeric Enum Mapping
// =============================================================================

/** Vault events carry a vault address + owner instead of an nftId */
function isVaultEvent(event: AnyCloseOrderEvent): boolean {
  return event.vaultAddress !== undefined;
}

/**
 * Builds the order identity hash for an event, via the helper shared with
 * UniswapV3CloseOrderService.refresh() — the other writer of these rows.
 */
function orderIdentityHashForEvent(event: AnyCloseOrderEvent): string {
  const triggerMode = parseTriggerMode(event.triggerMode);

  if (isVaultEvent(event)) {
    if (!event.ownerAddress) {
      throw new UnroutableCloseOrderEventError(
        `Vault close order event missing ownerAddress: type=${event.type} ` +
          `vault=${event.vaultAddress} tx=${event.transactionHash}`
      );
    }
    return createCloseOrderIdentityHash({
      protocol: 'uniswapv3-vault',
      chainId: event.chainId,
      vaultAddress: event.vaultAddress!,
      ownerAddress: event.ownerAddress,
      triggerMode,
    });
  }

  if (!event.nftId) {
    throw new UnroutableCloseOrderEventError(
      `Close order event has neither nftId nor vaultAddress: type=${event.type} ` +
        `tx=${event.transactionHash}`
    );
  }

  return createCloseOrderIdentityHash({
    protocol: 'uniswapv3',
    chainId: event.chainId,
    nftId: event.nftId,
    triggerMode,
  });
}

/** Log context identifying the position an event refers to, for either protocol */
function eventIdentityContext(event: AnyCloseOrderEvent): Record<string, unknown> {
  return {
    type: event.type,
    chainId: event.chainId,
    ...(isVaultEvent(event)
      ? { vaultAddress: event.vaultAddress, ownerAddress: event.ownerAddress }
      : { nftId: event.nftId }),
    triggerMode: event.triggerMode,
    txHash: event.transactionHash,
  };
}

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

/**
 * Injectable collaborators. Production passes none; tests pass stubs so the rule
 * can be exercised without RPC configuration.
 */
export interface UniswapV3ProcessCloseOrderEventsRuleDependencies {
  orderService?: UniswapV3CloseOrderService;
  automationSubscriptionService?: AutomationSubscriptionService;
  automationLogService?: AutomationLogService;
  positionService?: UniswapV3PositionService;
  vaultPositionService?: UniswapV3VaultPositionService;
}

export class UniswapV3ProcessCloseOrderEventsRule extends BusinessRule {
  readonly ruleName = 'uniswapv3-process-close-order-events';
  readonly ruleDescription =
    'Processes UniswapV3 close order lifecycle events from on-chain data (registration, cancellation, execution, config updates)';

  private consumerTag: string | null = null;
  private orderService: UniswapV3CloseOrderService;
  private automationSubscriptionService: AutomationSubscriptionService;
  private automationLogService: AutomationLogService;
  private positionService: UniswapV3PositionService;
  private vaultPositionService: UniswapV3VaultPositionService;

  constructor(dependencies: UniswapV3ProcessCloseOrderEventsRuleDependencies = {}) {
    super();
    this.orderService =
      dependencies.orderService ?? new UniswapV3CloseOrderService({ prisma });
    this.automationSubscriptionService =
      dependencies.automationSubscriptionService ??
      new AutomationSubscriptionService({ prisma });
    this.automationLogService =
      dependencies.automationLogService ?? new AutomationLogService({ prisma });
    this.positionService =
      dependencies.positionService ?? new UniswapV3PositionService({ prisma });
    this.vaultPositionService =
      dependencies.vaultPositionService ?? new UniswapV3VaultPositionService({ prisma });
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

    // Dead-letter topology: messages we cannot interpret land in the DLQ instead
    // of being discarded, which is what made vault event loss invisible.
    await this.channel.assertExchange(EXCHANGE_CLOSE_ORDER_EVENTS_DLX, 'fanout', {
      durable: true,
      autoDelete: false,
    });
    await this.channel.assertQueue(DLQ_NAME, {
      durable: true,
      autoDelete: false,
      arguments: {
        'x-message-ttl': CLOSE_ORDER_DLQ_MESSAGE_TTL_MS,
      },
    });
    await this.channel.bindQueue(DLQ_NAME, EXCHANGE_CLOSE_ORDER_EVENTS_DLX, '');

    // Assert queue and bind to close order events exchange for both UniswapV3 variants
    await this.channel.assertQueue(QUEUE_NAME, {
      durable: true,
      autoDelete: false,
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_CLOSE_ORDER_EVENTS_DLX,
      },
    });
    await this.channel.bindQueue(
      QUEUE_NAME,
      EXCHANGE_CLOSE_ORDER_EVENTS,
      UNISWAPV3_ROUTING_PATTERN
    );
    await this.channel.bindQueue(
      QUEUE_NAME,
      EXCHANGE_CLOSE_ORDER_EVENTS,
      UNISWAPV3_VAULT_ROUTING_PATTERN
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
        routingPatterns: [UNISWAPV3_ROUTING_PATTERN, UNISWAPV3_VAULT_ROUTING_PATTERN],
      },
      'Subscribed to UniswapV3 close order events'
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

      this.logger.debug(eventIdentityContext(event), 'Processing close order event');

      await this.processEvent(event);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        {
          routingKey: msg.fields.routingKey,
          unroutable: error instanceof UnroutableCloseOrderEventError,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Error processing close order event — dead-lettering'
      );
      // Dead-letter the message, don't requeue (prevents infinite retry loops).
      // The queue is declared with x-dead-letter-exchange, so this lands in the DLQ.
      this.channel.nack(msg, false, false);
    }
  }

  /**
   * Dispatches to the handler for the event's lifecycle type. NFT and vault
   * variants of the same event share a handler — identity and position lookup
   * are the only protocol-specific parts, and both are resolved inside.
   */
  private async processEvent(event: AnyCloseOrderEvent): Promise<void> {
    switch (event.type) {
      case 'close-order.registered.uniswapv3':
      case 'close-order.registered.uniswapv3-vault':
        return this.handleRegistered(event);
      case 'close-order.cancelled.uniswapv3':
      case 'close-order.cancelled.uniswapv3-vault':
        return this.handleCancelled(event);
      case 'close-order.executed.uniswapv3':
      case 'close-order.executed.uniswapv3-vault':
        return this.handleExecuted(event);
      case 'close-order.operator-updated.uniswapv3':
      case 'close-order.operator-updated.uniswapv3-vault':
        return this.handleOperatorUpdated(event);
      case 'close-order.payout-updated.uniswapv3':
      case 'close-order.payout-updated.uniswapv3-vault':
        return this.handlePayoutUpdated(event);
      case 'close-order.trigger-tick-updated.uniswapv3':
      case 'close-order.trigger-tick-updated.uniswapv3-vault':
        return this.handleTriggerTickUpdated(event);
      case 'close-order.valid-until-updated.uniswapv3':
      case 'close-order.valid-until-updated.uniswapv3-vault':
        return this.handleValidUntilUpdated(event);
      case 'close-order.slippage-updated.uniswapv3':
      case 'close-order.slippage-updated.uniswapv3-vault':
        return this.handleSlippageUpdated(event);
      case 'close-order.swap-intent-updated.uniswapv3':
      case 'close-order.swap-intent-updated.uniswapv3-vault':
        return this.handleSwapIntentUpdated(event);
      case 'close-order.shares-updated.uniswapv3-vault':
        return this.handleSharesUpdated(event);
      default:
        // Not "understood but not ours" — we cannot interpret this at all.
        throw new UnroutableCloseOrderEventError(
          `Unknown close order event type: ${(event as AnyCloseOrderEvent).type}`
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
    const orderIdentityHash = orderIdentityHashForEvent(event);
    const order = await this.orderService.findByOrderIdentityHash(
      orderIdentityHash,
      tx
    );

    if (!order) {
      // Understood, but not ours — e.g. an order registered by a share holder we
      // don't track, or an event for an order already removed. Not a fault.
      this.logger.info(
        { ...eventIdentityContext(event), orderIdentityHash },
        'No matching close order found for event, skipping'
      );
    }

    return order;
  }

  /**
   * Finds the position an event refers to.
   *
   * NFT:   by nftId + chainId.
   * Vault: by vault address + owner address + chainId — a vault is an ERC-20, so
   *        the owner is part of the position discriminator.
   *
   * Returns null when we simply don't track this position. Throws when the match
   * is ambiguous: a CloseOrder row points at exactly one position, so more than
   * one candidate is a state we cannot represent and must not guess at.
   */
  private async findPositionForEvent(
    event: AnyCloseOrderEvent,
    tx?: TxClient
  ): Promise<{ id: string; config: Record<string, unknown> } | null> {
    const db = tx ?? prisma;

    if (isVaultEvent(event)) {
      if (!event.ownerAddress) {
        throw new UnroutableCloseOrderEventError(
          `Vault close order event missing ownerAddress: type=${event.type} ` +
            `vault=${event.vaultAddress} tx=${event.transactionHash}`
        );
      }

      // Position config stores both addresses EIP-55 checksummed
      const vaultAddress = normalizeAddress(event.vaultAddress!);
      const ownerAddress = normalizeAddress(event.ownerAddress);

      const positions = await db.position.findMany({
        where: {
          protocol: 'uniswapv3-vault',
          AND: [
            { config: { path: ['chainId'], equals: event.chainId } },
            { config: { path: ['vaultAddress'], equals: vaultAddress } },
            { config: { path: ['ownerAddress'], equals: ownerAddress } },
          ],
        },
        select: { id: true, config: true },
      });

      if (positions.length > 1) {
        throw new UnroutableCloseOrderEventError(
          `Ambiguous vault position for close order event: ${positions.length} matches ` +
            `for chainId=${event.chainId} vault=${vaultAddress} owner=${ownerAddress} ` +
            `(ids: ${positions.map((p) => p.id).join(', ')})`
        );
      }

      const match = positions[0];
      return match
        ? { id: match.id, config: match.config as Record<string, unknown> }
        : null;
    }

    if (!event.nftId) {
      throw new UnroutableCloseOrderEventError(
        `Close order event has neither nftId nor vaultAddress: type=${event.type} ` +
          `tx=${event.transactionHash}`
      );
    }

    const positions = await db.position.findMany({
      where: {
        protocol: 'uniswapv3',
        config: {
          path: ['nftId'],
          equals: parseInt(event.nftId, 10),
        },
      },
      select: { id: true, config: true },
    });

    const match = positions.find((p) => {
      const config = p.config as { chainId: number };
      return config.chainId === event.chainId;
    });

    return match ? { id: match.id, config: match.config as Record<string, unknown> } : null;
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

    // Protocol-specific service; both expose isToken0Quote and pool token decimals
    const position =
      order.protocol === 'uniswapv3-vault'
        ? await this.vaultPositionService.findById(order.positionId, tx)
        : await this.positionService.findById(order.positionId, tx);

    if (!position) {
      this.logger.warn(
        { positionId: order.positionId, orderId: order.id, protocol: order.protocol },
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
  private buildCreateInput(event: RegisteredEvent, positionId: string) {
    const triggerMode = parseTriggerMode(event.triggerMode);
    const { payload } = event;
    const isVault = isVaultEvent(event);

    // Config must match byte for byte what UniswapV3CloseOrderService.refresh()
    // writes — it is the other writer of these rows.
    const config = isVault
      ? {
          chainId: event.chainId,
          vaultAddress: normalizeAddress(event.vaultAddress!),
          ownerAddress: normalizeAddress(event.ownerAddress!),
          triggerMode,
          contractAddress: event.contractAddress,
        }
      : {
          chainId: event.chainId,
          nftId: event.nftId,
          triggerMode,
          contractAddress: event.contractAddress,
        };

    return {
      protocol: (isVault ? 'uniswapv3-vault' : 'uniswapv3') as
        | 'uniswapv3-vault'
        | 'uniswapv3',
      positionId,
      orderIdentityHash: orderIdentityHashForEvent(event),
      closeOrderHash: deriveCloseOrderHashFromTick(triggerMode, payload.triggerTick),
      config,
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
        // Vault share amount covered by the order (bigint as string)
        ...(payload.shares !== undefined ? { shares: payload.shares } : {}),
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
  private async handleRegistered(event: RegisteredEvent): Promise<void> {
    const { chainId, transactionHash, payload } = event;
    const orderIdentityHash = orderIdentityHashForEvent(event);

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
        const wasTerminal = existingOrder.automationState === 'failed';

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

      // Find the position this order belongs to
      const position = existingOrder
        ? await tx.position.findUnique({
            where: { id: existingOrder.positionId },
            select: { id: true, config: true },
          })
        : await this.findPositionForEvent(event, tx);

      if (!position) {
        // A share holder we don't track can register an order on a vault we do
        // track — expected, not a fault.
        this.logger.info(
          eventIdentityContext(event),
          'No position found for registered close order event, skipping'
        );
        return null;
      }

      // Ensure the identity slot holds this order (idempotent against the
      // concurrent writer, UniswapV3CloseOrderService.refresh())
      const createInput = this.buildCreateInput(event, position.id);
      const created = await this.orderService.upsertByIdentityHash(createInput, tx);

      const isNew = !existingOrder;

      this.logger.info(
        {
          ...eventIdentityContext(event),
          orderId: created.id,
          positionId: position.id,
          protocol: created.protocol,
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

      const positionConfig = position.config as Record<string, unknown>;
      const poolAddress = (positionConfig.poolAddress as string | undefined)?.toLowerCase();

      return {
        orderId: created.id,
        positionId: position.id,
        orderIdentityHash: createInput.orderIdentityHash,
        poolAddress: poolAddress ?? null,
        isNew,
      };
    });

    // Ensure per-order subscription outside transaction
    if (result) {
      const poolAddress = result.poolAddress ?? payload.pool;
      if (poolAddress) {
        await this.automationSubscriptionService.ensureOrderSubscription(result.orderId, chainId, poolAddress);
      }
    }

    // Publish close-order.registered domain event (direct, best-effort)
    if (result) {
      this.publishDomainEvent<CloseOrderLifecyclePayload>('close-order.registered', {
        entityId: result.orderId,
        payload: {
          orderId: result.orderId,
          positionId: result.positionId,
          orderIdentityHash: result.orderIdentityHash,
        },
      });
    }
  }

  /**
   * Handles OrderCancelled events.
   * DB lifecycle: on-chain cancellation → DELETE from DB.
   * Removes the pool subscription if no more monitoring orders reference that pool.
   */
  private async handleCancelled(event: CancelledEvent): Promise<void> {
    const cancelResult = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      const previousState = order.automationState;

      // Build order tag before delete (order still has data)
      const orderTag = await this.buildOrderTag(order, tx);

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
        orderIdentityHash: order.orderIdentityHash,
        previousState,
      };
    });

    // Remove per-order DB subscription (trivial — no "remaining orders?" check needed)
    if (cancelResult) {
      await this.automationSubscriptionService.removeOrderSubscription(cancelResult.orderId);
    }

    // Publish close-order.cancelled domain event (direct, best-effort)
    if (cancelResult) {
      this.publishDomainEvent<CloseOrderCancelledPayload>('close-order.cancelled', {
        entityId: cancelResult.orderId,
        payload: {
          orderId: cancelResult.orderId,
          positionId: cancelResult.positionId,
          orderIdentityHash: cancelResult.orderIdentityHash,
          reason: 'on_chain',
        },
      });
    }
  }

  /**
   * Handles OrderExecuted events.
   * DB lifecycle: on-chain execution → DELETE from DB.
   * Execution data is captured in AutomationLog before deletion.
   */
  private async handleExecuted(event: ExecutedEvent): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      // Build order tag before delete (needs order data)
      const orderTag = await this.buildOrderTag(order, tx);

      // Log ORDER_EXECUTED before deleting (needs order.id reference)
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

      // DELETE the order from DB (execution history preserved in AutomationLog)
      await this.orderService.delete(order.id, tx);

      this.logger.info(
        {
          orderId: order.id,
          executionTick: event.payload.executionTick,
          txHash: event.transactionHash,
        },
        'Close order deleted after on-chain execution'
      );

      return {
        orderId: order.id,
        positionId: order.positionId,
        orderIdentityHash: order.orderIdentityHash,
      };
    });

    // Remove per-order DB subscription (trivial — no "remaining orders?" check needed)
    if (result) {
      await this.automationSubscriptionService.removeOrderSubscription(result.orderId);
    }

    // Publish close-order.executed domain event (direct, best-effort)
    if (result) {
      this.publishDomainEvent<CloseOrderExecutedPayload>('close-order.executed', {
        entityId: result.orderId,
        payload: {
          orderId: result.orderId,
          positionId: result.positionId,
          orderIdentityHash: result.orderIdentityHash,
          executionTxHash: event.transactionHash,
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
    orderIdentityHash: string,
  ): void {
    this.publishDomainEvent<CloseOrderLifecyclePayload>('close-order.modified', {
      entityId: orderId,
      payload: {
        orderId,
        positionId,
        orderIdentityHash,
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
    event: OperatorUpdatedEvent
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

      return { orderId: order.id, positionId: order.positionId, orderIdentityHash: order.orderIdentityHash };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, result.orderIdentityHash);
    }
  }

  /**
   * Handles OrderPayoutUpdated events.
   */
  private async handlePayoutUpdated(
    event: PayoutUpdatedEvent
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

      return { orderId: order.id, positionId: order.positionId, orderIdentityHash: order.orderIdentityHash };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, result.orderIdentityHash);
    }
  }

  /**
   * Handles OrderTriggerTickUpdated events.
   *
   * Updates triggerTick and recalculates closeOrderHash.
   * No more isToken0Quote/sqrtPriceX96 logic — tick is stored directly.
   */
  private async handleTriggerTickUpdated(
    event: TriggerTickUpdatedEvent
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

      return { orderId: order.id, positionId: order.positionId, orderIdentityHash: order.orderIdentityHash };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, result.orderIdentityHash);
    }
  }

  /**
   * Handles OrderValidUntilUpdated events.
   */
  private async handleValidUntilUpdated(
    event: ValidUntilUpdatedEvent
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

      return { orderId: order.id, positionId: order.positionId, orderIdentityHash: order.orderIdentityHash };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, result.orderIdentityHash);
    }
  }

  /**
   * Handles OrderSlippageUpdated events.
   */
  private async handleSlippageUpdated(
    event: SlippageUpdatedEvent
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

      return { orderId: order.id, positionId: order.positionId, orderIdentityHash: order.orderIdentityHash };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, result.orderIdentityHash);
    }
  }

  /**
   * Handles OrderSwapIntentUpdated events.
   */
  private async handleSwapIntentUpdated(
    event: SwapIntentUpdatedEvent
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

      return { orderId: order.id, positionId: order.positionId, orderIdentityHash: order.orderIdentityHash };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, result.orderIdentityHash);
    }
  }

  /**
   * Handles OrderSharesUpdated events (vault only).
   *
   * The executor reads the share amount from the chain at execution time, so the
   * stored value is display state — but a stored value that silently goes stale
   * is the failure mode this rule exists to remove.
   */
  private async handleSharesUpdated(
    event: VaultOrderSharesUpdatedEvent
  ): Promise<void> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.resolveOrder(event, tx);
      if (!order) return null;

      // Share amounts are bigint — keep them as strings end to end
      await this.orderService.mergeState(
        order.id,
        { shares: event.payload.newShares },
        tx
      );

      this.logger.info(
        {
          orderId: order.id,
          oldShares: event.payload.oldShares,
          newShares: event.payload.newShares,
        },
        'Close order shares updated'
      );

      const orderTag = await this.buildOrderTag(order, tx);
      if (orderTag) {
        await this.automationLogService.logOrderModified(
          order.positionId,
          order.id,
          {
            orderTag,
            changes: 'shares',
            chainId: event.chainId,
          } satisfies OrderModifiedContext,
          tx
        );
      }

      return { orderId: order.id, positionId: order.positionId, orderIdentityHash: order.orderIdentityHash };
    });

    if (result) {
      this.publishModifiedEvent(result.orderId, result.positionId, result.orderIdentityHash);
    }
  }
}
