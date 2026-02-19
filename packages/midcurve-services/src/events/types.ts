/**
 * Domain Events Type Definitions
 *
 * Unified event schema for the Midcurve Finance domain events layer.
 * Events are published to RabbitMQ for decoupled, event-driven processing.
 */

import type { PositionJSON } from '@midcurve/shared';

// ============================================================
// Event Type Discriminators
// ============================================================

/**
 * Position event types - emitted when position state changes
 */
export type PositionEventType =
  | 'position.created'
  | 'position.closed'
  | 'position.deleted'
  | 'position.liquidity.increased'
  | 'position.liquidity.decreased'
  | 'position.fees.collected'
  | 'position.state.refreshed';

/**
 * Close order event types - emitted when close order on-chain state changes
 */
export type CloseOrderEventType =
  | 'close-order.registered'
  | 'close-order.cancelled'
  | 'close-order.executed'
  | 'close-order.modified';

/**
 * User event types - emitted when user lifecycle changes occur
 */
export type UserEventType = 'user.registered';

/**
 * All supported domain event types
 */
export type DomainEventType = PositionEventType | CloseOrderEventType | UserEventType;

/**
 * Entity types for routing and filtering
 */
export type DomainEntityType = 'position' | 'order' | 'pool' | 'user';

/**
 * Source services that can publish events
 */
export type DomainEventSource = 'api' | 'automation' | 'business-logic' | 'ledger-sync';

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

  /** Event type discriminator (e.g., 'position.closed', 'close-order.cancelled') */
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
 *
 * Contains the full position data including nested pool and token information
 * for complete audit trails and downstream business processes.
 */
export type PositionCreatedPayload = PositionJSON;

/**
 * Payload for position.closed event
 * Emitted when a position's liquidity drops to 0
 *
 * Contains the full position data including nested pool and token information
 * for complete audit trails and downstream business processes.
 */
export type PositionClosedPayload = PositionJSON;

/**
 * Payload for position.deleted event
 * Emitted when a position is removed from the database by user action
 *
 * Contains the full position data including nested pool and token information
 * for complete audit trails and downstream business processes.
 */
export type PositionDeletedPayload = PositionJSON;

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
// Close Order Event Payloads
// ============================================================

/**
 * Reason for close order cancellation
 */
export type CloseOrderCancelReason = 'position_closed' | 'user_cancelled' | 'expired' | 'on_chain';

/**
 * Payload for close-order.registered event
 * Emitted when a close order is activated on-chain (NONE→ACTIVE)
 */
export interface CloseOrderRegisteredPayload {
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
 * Payload for close-order.cancelled event
 * Emitted when a close order is cancelled on-chain (ACTIVE→CANCELLED)
 */
export interface CloseOrderCancelledPayload {
  orderId: string;
  positionId: string;
  /** Reason for cancellation */
  reason: CloseOrderCancelReason;
  /** Status before cancellation */
  previousStatus: string;
  cancelledAt: string;
}

/**
 * Payload for close-order.executed event
 * Emitted when a close order is executed on-chain (ACTIVE→EXECUTED)
 */
export interface CloseOrderExecutedPayload {
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
 * Payload for close-order.modified event
 * Emitted when a close order's on-chain config is updated
 */
export interface CloseOrderModifiedPayload {
  orderId: string;
  positionId: string;
  chainId: number;
  /** Which fields were modified */
  modifiedFields: string[];
  modifiedAt: string;
}

/**
 * Payload for close-order.created (user-initiated, not on-chain)
 */
export interface CloseOrderCreatedPayload {
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
 * Payload for close-order.triggered (executor-specific, not on-chain)
 */
export interface CloseOrderTriggeredPayload {
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
 * Payload for close-order.failed (executor-specific, not on-chain)
 */
export interface CloseOrderFailedPayload {
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
 * Close order cancelled event with typed payload
 */
export type CloseOrderCancelledEvent = DomainEvent<CloseOrderCancelledPayload>;

/**
 * Close order triggered event with typed payload
 */
export type CloseOrderTriggeredEvent = DomainEvent<CloseOrderTriggeredPayload>;

/**
 * Close order executed event with typed payload
 */
export type CloseOrderExecutedEvent = DomainEvent<CloseOrderExecutedPayload>;

/**
 * Close order modified event with typed payload
 */
export type CloseOrderModifiedEvent = DomainEvent<CloseOrderModifiedPayload>;

// ============================================================
// User Event Payloads
// ============================================================

/**
 * Payload for user.registered event
 * Emitted when a new user is created via SIWE authentication
 */
export interface UserRegisteredPayload {
  userId: string;
  /** Primary wallet address used to register (EIP-55 checksummed) */
  walletAddress: string;
  /** ISO 8601 timestamp of registration */
  registeredAt: string;
}

/**
 * User registered event with typed payload
 */
export type UserRegisteredEvent = DomainEvent<UserRegisteredPayload>;

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
