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
  | 'position.burned'
  | 'position.deleted'
  | 'position.liquidity.increased'
  | 'position.liquidity.decreased'
  | 'position.liquidity.reverted'
  | 'position.fees.collected'
  | 'position.transferred.in'
  | 'position.transferred.out';

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
 * Payload for position lifecycle events (created, closed, burned, deleted).
 *
 * Contains only reference IDs — consumers look up position details by positionId
 * when needed. Protocol-agnostic: works for any position type.
 *
 * Edge case: for position.deleted the DB row is already gone, but positionHash
 * is sufficient for cleanup operations (e.g. deleting journal entries by ref).
 */
export interface PositionLifecyclePayload {
  positionId: string;
  /** Composite position identity: "positionType/...type-specific-segments" */
  positionHash: string;
}

/**
 * Payload for position events linked to a ledger event
 * (liquidity.increased, liquidity.decreased, fees.collected, transferred.in/out).
 *
 * Contains only reference IDs — consumers look up financial details from the
 * PositionLedgerEvent via ledgerInputHash. Protocol-agnostic: the base ledger
 * event has universal financial fields (tokenValue, deltaCostBasis, deltaPnl, etc.).
 */
export interface PositionLedgerEventPayload {
  positionId: string;
  /** Composite position identity: "positionType/...type-specific-segments" */
  positionHash: string;
  /** Composite ledger event ID for deterministic lookup */
  ledgerInputHash: string;
  /** Block timestamp of the event (ISO 8601) */
  eventTimestamp: string;
}

/**
 * Payload for position.liquidity.reverted event.
 * Emitted when a chain reorg causes ledger events to be removed from a position.
 */
export interface PositionLiquidityRevertedPayload {
  positionId: string;
  positionHash: string;
  /** Block hash of the reverted block */
  blockHash: string;
  /** Number of ledger events removed */
  deletedCount: number;
  /** ISO 8601 timestamp when the revert was detected */
  revertedAt: string;
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

/** Position lifecycle event (created/closed/burned/deleted) */
export type PositionLifecycleEvent = DomainEvent<PositionLifecyclePayload>;

/** Position ledger-linked event (liquidity/fees/transfer) */
export type PositionLedgerEvent = DomainEvent<PositionLedgerEventPayload>;

/** Position liquidity reverted event */
export type PositionLiquidityRevertedEvent = DomainEvent<PositionLiquidityRevertedPayload>;

/** Close order cancelled event */
export type CloseOrderCancelledEvent = DomainEvent<CloseOrderCancelledPayload>;

/** Close order triggered event */
export type CloseOrderTriggeredEvent = DomainEvent<CloseOrderTriggeredPayload>;

/** Close order executed event */
export type CloseOrderExecutedEvent = DomainEvent<CloseOrderExecutedPayload>;

/** Close order modified event */
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
