/**
 * Domain Events Module
 *
 * Event-driven architecture for decoupled communication between services.
 * Uses RabbitMQ for message transport and PostgreSQL for reliable delivery (outbox pattern).
 *
 * ## Architecture Overview
 *
 * ```
 * ┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
 * │  Services       │────▶│  DomainEventOutbox  │────▶│  RabbitMQ       │
 * │  (Publishers)   │     │  (PostgreSQL)       │     │  (Message Bus)  │
 * └─────────────────┘     └─────────────────────┘     └────────┬────────┘
 *                                                              │
 *                                                              ▼
 *                         ┌─────────────────────┐     ┌─────────────────┐
 *                         │  DomainEvent        │     │  Consumers      │
 *                         │  (Permanent Store)  │◀────│  (Handlers)     │
 *                         └─────────────────────┘     └─────────────────┘
 * ```
 *
 * ## Usage
 *
 * ### Publishing Events (Transactional)
 *
 * ```typescript
 * import { getDomainEventPublisher, createDomainEvent } from '@midcurve/services/events';
 *
 * const publisher = getDomainEventPublisher({ prisma });
 *
 * // Within a transaction for atomicity
 * await prisma.$transaction(async (tx) => {
 *   // Update state
 *   await tx.position.update({ ... });
 *
 *   // Publish event (written to outbox in same transaction)
 *   const event = createDomainEvent({
 *     type: 'position.closed',
 *     entityType: 'position',
 *     entityId: positionId,
 *     payload: { ... },
 *     source: 'ledger-sync',
 *   });
 *   await publisher.publish(event, tx);
 * });
 * ```
 *
 * ### Consuming Events
 *
 * ```typescript
 * import { DomainEventConsumer, DomainEvent } from '@midcurve/services/events';
 *
 * class MyHandler extends DomainEventConsumer<MyPayload> {
 *   readonly eventPattern = 'position.*.closed';
 *   readonly queueName = 'domain.position-closed.my-handler';
 *
 *   async handle(event: DomainEvent<MyPayload>): Promise<void> {
 *     // Handle the event
 *   }
 * }
 *
 * const handler = new MyHandler();
 * await handler.start(channel);
 * ```
 *
 * ### Starting the Outbox Publisher
 *
 * ```typescript
 * import { OutboxPublisher } from '@midcurve/services/events';
 *
 * const outboxPublisher = new OutboxPublisher({ prisma, channel });
 * outboxPublisher.start();
 * ```
 */

// ============================================================
// Types
// ============================================================

export type {
  // Event types
  DomainEventType,
  PositionEventType,
  CloseOrderEventType,
  UserEventType,
  DomainEntityType,
  DomainEventSource,
  // Event envelope
  DomainEvent,
  DomainEventMetadata,
  // Position payloads
  PositionCreatedPayload,
  PositionClosedPayload,
  PositionBurnedPayload,
  PositionDeletedPayload,
  PositionLiquidityIncreasedPayload,
  PositionLiquidityDecreasedPayload,
  PositionFeesCollectedPayload,
  PositionLiquidityRevertedPayload,
  PositionStateRefreshedPayload,
  // Close order payloads (on-chain state changes)
  CloseOrderCancelReason,
  CloseOrderRegisteredPayload,
  CloseOrderCancelledPayload,
  CloseOrderExecutedPayload,
  CloseOrderModifiedPayload,
  // Close order payloads (executor-specific)
  CloseOrderCreatedPayload,
  CloseOrderTriggeredPayload,
  CloseOrderFailedPayload,
  // User payloads
  UserRegisteredPayload,
  // Typed events
  PositionClosedEvent,
  PositionLiquidityIncreasedEvent,
  PositionLiquidityDecreasedEvent,
  PositionFeesCollectedEvent,
  PositionLiquidityRevertedEvent,
  CloseOrderCancelledEvent,
  CloseOrderTriggeredEvent,
  CloseOrderExecutedEvent,
  CloseOrderModifiedEvent,
  UserRegisteredEvent,
  // Outbox
  OutboxStatus,
  DomainEventOutboxRecord,
} from './types.js';

// ============================================================
// Topology
// ============================================================

export {
  // Constants
  DOMAIN_EVENTS_EXCHANGE,
  DOMAIN_EVENTS_DLX,
  DOMAIN_QUEUES,
  ROUTING_PATTERNS,
  DLQ_MESSAGE_TTL_MS,
  // Functions - Position routing keys
  buildPositionRoutingKey,
  parsePositionRoutingKey,
  // Functions - Order routing keys
  buildOrderRoutingKey,
  getEventSuffix,
  // Functions - User routing keys
  buildUserRoutingKey,
  // Functions - Legacy (deprecated)
  buildRoutingKey,
  // Functions - Topology setup
  setupDomainEventsTopology,
  setupConsumerQueue,
  verifyDomainEventsTopology,
} from './topology.js';

export type {
  PositionCoordinates,
  ParsedPositionRoutingKey,
} from './topology.js';

// ============================================================
// Publisher
// ============================================================

export {
  // Classes
  DomainEventPublisher,
  // Functions
  createDomainEvent,
  getDomainEventPublisher,
  resetDomainEventPublisher,
} from './publisher.js';

export type {
  CreateDomainEventInput,
  DomainEventPublisherDependencies,
} from './publisher.js';

// ============================================================
// Outbox
// ============================================================

export {
  // Classes
  OutboxPublisher,
  // Config
  OUTBOX_CONFIG,
} from './outbox.js';

export type { OutboxPublisherDependencies } from './outbox.js';

// ============================================================
// Consumer
// ============================================================

export {
  // Classes
  DomainEventConsumer,
  DomainEventConsumerRegistry,
} from './consumer.js';

