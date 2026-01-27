/**
 * Domain Events RabbitMQ Topology
 *
 * Declares exchanges, queues, and bindings for the domain events layer.
 * All operations are idempotent - safe to call multiple times.
 */

import type { Channel } from 'amqplib';

// ============================================================
// Constants
// ============================================================

/**
 * Domain events exchange name
 * Topic exchange for flexible routing with wildcards
 */
export const DOMAIN_EVENTS_EXCHANGE = 'domain-events';

/**
 * Dead letter exchange for failed event processing
 */
export const DOMAIN_EVENTS_DLX = 'domain-events-dlx';

/**
 * Queue name patterns for domain event consumers
 */
export const DOMAIN_QUEUES = {
  /** Dead letter queue for failed events */
  DLQ: 'domain.events.dlq',
  /** Order cancellation handler queue */
  POSITION_CLOSED_ORDER_CANCELLER: 'domain.position-closed.order-canceller',
} as const;

/**
 * Routing key patterns for domain events
 * Uses RabbitMQ topic exchange pattern matching:
 * - `*` matches exactly one word
 * - `#` matches zero or more words
 */
export const ROUTING_PATTERNS = {
  /** All position created events: position.*.created */
  POSITION_CREATED: 'position.*.created',
  /** All position closed events: position.*.closed */
  POSITION_CLOSED: 'position.*.closed',
  /** All position events: position.# */
  ALL_POSITION_EVENTS: 'position.#',
  /** All order events: order.# */
  ALL_ORDER_EVENTS: 'order.#',
  /** All events: # */
  ALL_EVENTS: '#',
} as const;

/**
 * Build a routing key for a specific event
 *
 * @param entityType - 'position' or 'order'
 * @param entityId - Entity ID (positionId or orderId)
 * @param eventSuffix - Event type suffix (e.g., 'closed', 'cancelled')
 * @returns Routing key (e.g., 'position.abc123.closed')
 */
export function buildRoutingKey(
  entityType: 'position' | 'order',
  entityId: string,
  eventSuffix: string
): string {
  return `${entityType}.${entityId}.${eventSuffix}`;
}

/**
 * Extract event type suffix from a domain event type
 *
 * @param eventType - Full event type (e.g., 'position.closed')
 * @returns Event suffix (e.g., 'closed')
 */
export function getEventSuffix(eventType: string): string {
  const parts = eventType.split('.');
  return parts.slice(1).join('.');
}

// ============================================================
// Dead Letter Queue Configuration
// ============================================================

/** DLQ message retention time: 7 days in milliseconds */
export const DLQ_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================
// Topology Setup Functions
// ============================================================

/**
 * Setup core domain events topology.
 * Called once on service startup.
 *
 * Creates:
 * - domain-events (topic exchange)
 * - domain-events-dlx (fanout exchange for dead letters)
 * - domain.events.dlq (dead letter queue with 7-day retention)
 */
export async function setupDomainEventsTopology(channel: Channel): Promise<void> {
  console.log('[DomainEvents] Setting up domain events topology...');

  // Create main topic exchange for domain events
  await channel.assertExchange(DOMAIN_EVENTS_EXCHANGE, 'topic', {
    durable: true,
    autoDelete: false,
  });
  console.log(`[DomainEvents] Exchange declared: ${DOMAIN_EVENTS_EXCHANGE} (topic)`);

  // Create dead letter exchange (fanout - sends to all bound queues)
  await channel.assertExchange(DOMAIN_EVENTS_DLX, 'fanout', {
    durable: true,
    autoDelete: false,
  });
  console.log(`[DomainEvents] Exchange declared: ${DOMAIN_EVENTS_DLX} (fanout)`);

  // Create dead letter queue with 7-day retention
  await channel.assertQueue(DOMAIN_QUEUES.DLQ, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: {
      'x-message-ttl': DLQ_MESSAGE_TTL_MS,
    },
  });
  console.log(`[DomainEvents] Queue declared: ${DOMAIN_QUEUES.DLQ} (TTL: 7 days)`);

  // Bind DLQ to dead letter exchange
  await channel.bindQueue(DOMAIN_QUEUES.DLQ, DOMAIN_EVENTS_DLX, '');
  console.log(`[DomainEvents] Binding: ${DOMAIN_EVENTS_DLX} -> ${DOMAIN_QUEUES.DLQ}`);

  console.log('[DomainEvents] Core topology setup complete');
}

/**
 * Setup the position-closed order canceller consumer queue.
 * Called when starting the order cancellation consumer.
 *
 * Creates:
 * - domain.position-closed.order-canceller queue
 * - Binding: position.*.closed -> queue
 */
export async function setupPositionClosedOrderCancellerQueue(
  channel: Channel
): Promise<void> {
  const queueName = DOMAIN_QUEUES.POSITION_CLOSED_ORDER_CANCELLER;
  console.log(`[DomainEvents] Setting up queue: ${queueName}`);

  // Create queue with dead letter routing
  await channel.assertQueue(queueName, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: {
      'x-dead-letter-exchange': DOMAIN_EVENTS_DLX,
    },
  });
  console.log(`[DomainEvents] Queue declared: ${queueName}`);

  // Bind to position closed events
  await channel.bindQueue(queueName, DOMAIN_EVENTS_EXCHANGE, ROUTING_PATTERNS.POSITION_CLOSED);
  console.log(
    `[DomainEvents] Binding: ${DOMAIN_EVENTS_EXCHANGE} -> ${queueName} (pattern: ${ROUTING_PATTERNS.POSITION_CLOSED})`
  );
}

/**
 * Generic function to setup a consumer queue with a routing pattern.
 *
 * @param channel - RabbitMQ channel
 * @param queueName - Name of the queue to create
 * @param routingPattern - Routing pattern to bind (supports wildcards)
 */
export async function setupConsumerQueue(
  channel: Channel,
  queueName: string,
  routingPattern: string
): Promise<void> {
  console.log(`[DomainEvents] Setting up queue: ${queueName}`);

  // Create queue with dead letter routing
  await channel.assertQueue(queueName, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: {
      'x-dead-letter-exchange': DOMAIN_EVENTS_DLX,
    },
  });
  console.log(`[DomainEvents] Queue declared: ${queueName}`);

  // Bind to the specified routing pattern
  await channel.bindQueue(queueName, DOMAIN_EVENTS_EXCHANGE, routingPattern);
  console.log(
    `[DomainEvents] Binding: ${DOMAIN_EVENTS_EXCHANGE} -> ${queueName} (pattern: ${routingPattern})`
  );
}

// ============================================================
// Verification
// ============================================================

/**
 * Verify domain events topology exists.
 * Returns true if all core exchanges and queues exist.
 */
export async function verifyDomainEventsTopology(channel: Channel): Promise<boolean> {
  try {
    await channel.checkExchange(DOMAIN_EVENTS_EXCHANGE);
    await channel.checkExchange(DOMAIN_EVENTS_DLX);
    await channel.checkQueue(DOMAIN_QUEUES.DLQ);
    return true;
  } catch {
    return false;
  }
}
