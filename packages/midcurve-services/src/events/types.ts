/**
 * Domain Events Type Definitions
 *
 * Unified event schema for the Midcurve Finance domain events layer.
 * Events are published to RabbitMQ for decoupled, event-driven processing.
 */

// ============================================================
// Event Type Discriminators
// ============================================================

/**
 * Position event types - emitted when position state changes
 */
export type PositionEventType =
  | 'position.created'
  | 'position.closed'
  | 'position.liquidity.increased'
  | 'position.liquidity.decreased'
  | 'position.fees.collected'
  | 'position.state.refreshed';

/**
 * Automation/Order event types - emitted when close order state changes
 */
export type OrderEventType =
  | 'order.created'
  | 'order.registered'
  | 'order.triggered'
  | 'order.executed'
  | 'order.cancelled'
  | 'order.failed';

/**
 * All supported domain event types
 */
export type DomainEventType = PositionEventType | OrderEventType;

/**
 * Entity types for routing and filtering
 */
export type DomainEntityType = 'position' | 'order' | 'pool';

/**
 * Source services that can publish events
 */
export type DomainEventSource = 'api' | 'automation' | 'ledger-sync';

// ============================================================
// Event Envelope
// ============================================================

/**
 * Metadata attached to every domain event for tracing and debugging
 */
export interface DomainEventMetadata {
  /** Source service/component that published the event */
  source: DomainEventSource;
  /** Request/correlation ID for distributed tracing */
  traceId: string;
  /** Parent event ID if this event was caused by another event */
  causedBy?: string;
}

/**
 * Base domain event interface - the envelope for all events
 *
 * @template TPayload - Event-specific payload type
 */
export interface DomainEvent<TPayload = unknown> {
  /** Unique event ID (CUID) for idempotency */
  id: string;

  /** Event type discriminator (e.g., 'position.closed', 'order.cancelled') */
  type: DomainEventType;

  /** Aggregate/entity ID (positionId, orderId) */
  entityId: string;

  /** Entity type for routing and filtering */
  entityType: DomainEntityType;

  /** User ID if applicable (for user-scoped events) */
  userId?: string;

  /** Event timestamp (ISO 8601 string) */
  timestamp: string;

  /** Schema version for evolution (start at 1) */
  version: number;

  /** Event-specific payload */
  payload: TPayload;

  /** Metadata for tracing and debugging */
  metadata: DomainEventMetadata;
}

// ============================================================
// Position Event Payloads
// ============================================================

/**
 * Payload for position.created event
 */
export interface PositionCreatedPayload {
  positionId: string;
  poolId: string;
  chainId: number;
  nftId: string;
  protocol: string;
  createdAt: string;
}

/**
 * Final state of a position when closed (all amounts in smallest units as strings)
 */
export interface PositionFinalState {
  /** Token0 amount remaining (usually 0 for closed positions) */
  token0Amount: string;
  /** Token1 amount remaining (usually 0 for closed positions) */
  token1Amount: string;
  /** Total fees collected in token0 over position lifetime */
  collectedFees0: string;
  /** Total fees collected in token1 over position lifetime */
  collectedFees1: string;
}

/**
 * Payload for position.closed event
 * Emitted when a position's liquidity drops to 0
 */
export interface PositionClosedPayload {
  positionId: string;
  poolId: string;
  chainId: number;
  nftId: string;
  closedAt: string;
  /** Final state before closure */
  finalState: PositionFinalState;
}

/**
 * Payload for position.liquidity.increased event
 */
export interface PositionLiquidityIncreasedPayload {
  positionId: string;
  poolId: string;
  chainId: number;
  nftId: string;
  /** Amount of liquidity added (as string for bigint) */
  liquidityDelta: string;
  /** New total liquidity after increase (as string for bigint) */
  liquidityAfter: string;
  /** Token0 amount deposited (as string for bigint) */
  token0Amount: string;
  /** Token1 amount deposited (as string for bigint) */
  token1Amount: string;
  /** Block timestamp of the event */
  eventTimestamp: string;
}

/**
 * Payload for position.liquidity.decreased event
 */
export interface PositionLiquidityDecreasedPayload {
  positionId: string;
  poolId: string;
  chainId: number;
  nftId: string;
  /** Amount of liquidity removed (as string for bigint) */
  liquidityDelta: string;
  /** New total liquidity after decrease (as string for bigint) */
  liquidityAfter: string;
  /** Token0 amount withdrawn (as string for bigint) */
  token0Amount: string;
  /** Token1 amount withdrawn (as string for bigint) */
  token1Amount: string;
  /** Block timestamp of the event */
  eventTimestamp: string;
}

/**
 * Payload for position.fees.collected event
 */
export interface PositionFeesCollectedPayload {
  positionId: string;
  poolId: string;
  chainId: number;
  nftId: string;
  /** Fees collected in token0 (as string for bigint) */
  fees0: string;
  /** Fees collected in token1 (as string for bigint) */
  fees1: string;
  /** Total fees collected value in quote token (as string for bigint) */
  feesValueInQuote: string;
  /** Block timestamp of the collection */
  eventTimestamp: string;
}

/**
 * Payload for position.state.refreshed event
 */
export interface PositionStateRefreshedPayload {
  positionId: string;
  poolId: string;
  chainId: number;
  nftId: string;
  /** New liquidity value (as string for bigint) */
  liquidity: string;
  /** Current value in quote token (as string for bigint) */
  currentValue: string;
  /** Unrealized PnL (as string for bigint) */
  unrealizedPnl: string;
}

// ============================================================
// Order Event Payloads
// ============================================================

/**
 * Reason for order cancellation
 */
export type OrderCancelReason = 'position_closed' | 'user_cancelled' | 'expired';

/**
 * Payload for order.created event
 */
export interface OrderCreatedPayload {
  orderId: string;
  positionId: string;
  poolId: string;
  chainId: number;
  /** Trigger mode: 'stop_loss', 'take_profit', 'stop_loss_and_take_profit' */
  triggerMode: string;
  /** Lower price boundary (sqrtPriceX96 as string) */
  sqrtPriceX96Lower?: string;
  /** Upper price boundary (sqrtPriceX96 as string) */
  sqrtPriceX96Upper?: string;
}

/**
 * Payload for order.registered event
 * Emitted when order is registered on-chain
 */
export interface OrderRegisteredPayload {
  orderId: string;
  positionId: string;
  chainId: number;
  /** Transaction hash of registration */
  registrationTxHash: string;
  /** On-chain close ID */
  closeId: string;
  registeredAt: string;
}

/**
 * Payload for order.triggered event
 * Emitted when price condition is met
 */
export interface OrderTriggeredPayload {
  orderId: string;
  positionId: string;
  poolId: string;
  chainId: number;
  /** Which boundary was crossed */
  triggerSide: 'lower' | 'upper';
  /** Price at trigger time (sqrtPriceX96 as string) */
  triggerPrice: string;
  triggeredAt: string;
}

/**
 * Payload for order.executed event
 * Emitted when position is successfully closed
 */
export interface OrderExecutedPayload {
  orderId: string;
  positionId: string;
  chainId: number;
  /** Execution transaction hash */
  executionTxHash: string;
  /** Token0 amount received (as string for bigint) */
  amount0Out: string;
  /** Token1 amount received (as string for bigint) */
  amount1Out: string;
  /** Execution fee in basis points */
  executionFeeBps: number;
  executedAt: string;
}

/**
 * Payload for order.cancelled event
 */
export interface OrderCancelledPayload {
  orderId: string;
  positionId: string;
  /** Reason for cancellation */
  reason: OrderCancelReason;
  /** Status before cancellation */
  previousStatus: string;
  cancelledAt: string;
}

/**
 * Payload for order.failed event
 */
export interface OrderFailedPayload {
  orderId: string;
  positionId: string;
  chainId: number;
  /** Error message describing the failure */
  error: string;
  /** Number of retry attempts made */
  retryCount: number;
  /** Status before failure */
  previousStatus: string;
  failedAt: string;
}

// ============================================================
// Type-Safe Event Types
// ============================================================

/**
 * Position closed event with typed payload
 */
export type PositionClosedEvent = DomainEvent<PositionClosedPayload>;

/**
 * Position liquidity increased event with typed payload
 */
export type PositionLiquidityIncreasedEvent = DomainEvent<PositionLiquidityIncreasedPayload>;

/**
 * Position liquidity decreased event with typed payload
 */
export type PositionLiquidityDecreasedEvent = DomainEvent<PositionLiquidityDecreasedPayload>;

/**
 * Position fees collected event with typed payload
 */
export type PositionFeesCollectedEvent = DomainEvent<PositionFeesCollectedPayload>;

/**
 * Order cancelled event with typed payload
 */
export type OrderCancelledEvent = DomainEvent<OrderCancelledPayload>;

/**
 * Order triggered event with typed payload
 */
export type OrderTriggeredEvent = DomainEvent<OrderTriggeredPayload>;

/**
 * Order executed event with typed payload
 */
export type OrderExecutedEvent = DomainEvent<OrderExecutedPayload>;

// ============================================================
// Outbox Status
// ============================================================

/**
 * Status of an event in the outbox
 */
export type OutboxStatus = 'pending' | 'published' | 'failed';

/**
 * Outbox record shape (matches Prisma model)
 */
export interface DomainEventOutboxRecord {
  id: string;
  createdAt: Date;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  metadata: DomainEventMetadata;
  status: OutboxStatus;
  publishedAt: Date | null;
  retryCount: number;
  lastError: string | null;
}
