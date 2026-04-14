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
 * Wallet event types - emitted when user's wallet set changes
 */
export type WalletEventType = 'wallet.added' | 'wallet.removed';

/**
 * All supported domain event types
 */
export type DomainEventType = PositionEventType | CloseOrderEventType | UserEventType | WalletEventType;

/**
 * Entity types for routing and filtering
 */
export type DomainEntityType = 'position' | 'order' | 'pool' | 'user' | 'wallet';

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
 * Payload for close-order.registered and close-order.modified events.
 * Order exists in DB — consumers look up details by orderId.
 */
export interface CloseOrderLifecyclePayload {
  orderId: string;
  positionId: string;
  /** Composite identity: "protocol/chainId/identifier/triggerMode" */
  orderIdentityHash: string;
}

/**
 * Payload for close-order.cancelled event.
 * Order is deleted from DB before this event is published.
 * Includes reason since it's a semantic classification not available elsewhere.
 */
export interface CloseOrderCancelledPayload {
  orderId: string;
  positionId: string;
  orderIdentityHash: string;
  reason: CloseOrderCancelReason;
}

/**
 * Payload for close-order.executed event.
 * Order is deleted from DB before this event is published.
 * Includes executionTxHash for on-chain lookup of execution details.
 */
export interface CloseOrderExecutedPayload {
  orderId: string;
  positionId: string;
  orderIdentityHash: string;
  executionTxHash: string;
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

/** Close order lifecycle event (registered/modified) */
export type CloseOrderLifecycleEvent = DomainEvent<CloseOrderLifecyclePayload>;

/** Close order cancelled event */
export type CloseOrderCancelledEvent = DomainEvent<CloseOrderCancelledPayload>;

/** Close order executed event */
export type CloseOrderExecutedEvent = DomainEvent<CloseOrderExecutedPayload>;

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
// Wallet Event Payloads
// ============================================================

/**
 * Payload for wallet.added and wallet.removed events.
 * Emitted when a user adds or removes a wallet from their wallet perimeter.
 */
export interface WalletChangedPayload {
  userId: string;
  walletId: string;
  walletType: string;
  /** Normalized address (EIP-55 checksummed for EVM) */
  address: string;
}

/** Wallet added event with typed payload */
export type WalletAddedEvent = DomainEvent<WalletChangedPayload>;

/** Wallet removed event with typed payload */
export type WalletRemovedEvent = DomainEvent<WalletChangedPayload>;

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
