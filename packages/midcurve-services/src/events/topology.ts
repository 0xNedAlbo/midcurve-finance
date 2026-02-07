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
 *
 * Position event routing key format:
 *   positions.{action}.{protocol}.{chainId}.{nftId}
 *   e.g., positions.created.uniswapv3.1.12345
 *
 * Order event routing key format:
 *   orders.{action}.{orderId}
 *   e.g., orders.triggered.abc123
 */
export const ROUTING_PATTERNS = {
  // Position events: positions.{action}.{protocol}.{chainId}.{nftId}
  /** All position created events */
  POSITION_CREATED: 'positions.created.#',
  /** All position closed events */
  POSITION_CLOSED: 'positions.closed.#',
  /** All position deleted events */
  POSITION_DELETED: 'positions.deleted.#',
  /** All position liquidity increased events */
  POSITION_LIQUIDITY_INCREASED: 'positions.liquidity-increased.#',
  /** All position liquidity decreased events */
  POSITION_LIQUIDITY_DECREASED: 'positions.liquidity-decreased.#',
  /** All position fees collected events */
  POSITION_FEES_COLLECTED: 'positions.fees-collected.#',
  /** All position state refreshed events */
  POSITION_STATE_REFRESHED: 'positions.state-refreshed.#',
  /** All position events */
  ALL_POSITION_EVENTS: 'positions.#',

  // User events: users.{action}.{userId}
  /** All user registered events */
  USER_REGISTERED: 'users.registered.#',
  /** All user events */
  ALL_USER_EVENTS: 'users.#',

  // Order events (keeping existing format for now)
  /** All order events: order.# */
  ALL_ORDER_EVENTS: 'order.#',
  /** All events: # */
  ALL_EVENTS: '#',
} as const;

/**
 * Position coordinates extracted from positionHash or routing key
 */
export interface PositionCoordinates {
  protocol: string;
  chainId: number;
  nftId: string;
}

/**
 * Parsed position routing key (includes action)
 */
export interface ParsedPositionRoutingKey extends PositionCoordinates {
  action: string;
}

/**
 * Map from event type to routing key action
 */
const POSITION_EVENT_TO_ACTION: Record<string, string> = {
  'position.created': 'created',
  'position.closed': 'closed',
  'position.deleted': 'deleted',
  'position.liquidity.increased': 'liquidity-increased',
  'position.liquidity.decreased': 'liquidity-decreased',
  'position.fees.collected': 'fees-collected',
  'position.state.refreshed': 'state-refreshed',
};

/**
 * Map from user event type to routing key action
 */
const USER_EVENT_TO_ACTION: Record<string, string> = {
  'user.registered': 'registered',
};

/**
 * Build a routing key for user events
 *
 * @param eventType - Full event type (e.g., 'user.registered')
 * @param userId - User ID
 * @returns Routing key (e.g., 'users.registered.clxyz123abc')
 * @throws Error if event type is unknown
 */
export function buildUserRoutingKey(eventType: string, userId: string): string {
  const action = USER_EVENT_TO_ACTION[eventType];
  if (!action) {
    throw new Error(`Unknown user event type: ${eventType}`);
  }
  return `users.${action}.${userId}`;
}

/**
 * Parse a positionHash to extract coordinates
 *
 * @param positionHash - Position hash (e.g., 'uniswapv3/1/12345')
 * @returns Parsed coordinates or null if invalid
 */
export function parsePositionHash(positionHash: string): PositionCoordinates | null {
  const parts = positionHash.split('/');
  if (parts.length !== 3) {
    return null;
  }
  const [protocol, chainIdStr, nftId] = parts;
  if (!protocol || !chainIdStr || !nftId) {
    return null;
  }
  const chainId = parseInt(chainIdStr, 10);
  if (isNaN(chainId)) {
    return null;
  }
  return { protocol, chainId, nftId };
}

/**
 * Build a routing key for position events from positionHash
 *
 * @param eventType - Full event type (e.g., 'position.created')
 * @param positionHash - Position hash (e.g., 'uniswapv3/1/12345')
 * @returns Routing key (e.g., 'positions.created.uniswapv3.1.12345')
 * @throws Error if event type is unknown or positionHash is invalid
 */
export function buildPositionRoutingKey(eventType: string, positionHash: string): string {
  const action = POSITION_EVENT_TO_ACTION[eventType];
  if (!action) {
    throw new Error(`Unknown position event type: ${eventType}`);
  }
  const coords = parsePositionHash(positionHash);
  if (!coords) {
    throw new Error(`Invalid positionHash format: ${positionHash}`);
  }
  return `positions.${action}.${coords.protocol}.${coords.chainId}.${coords.nftId}`;
}

/**
 * Parse a position routing key to extract coordinates
 *
 * @param routingKey - Routing key (e.g., 'positions.created.uniswapv3.1.12345')
 * @returns Parsed coordinates or null if invalid
 */
export function parsePositionRoutingKey(routingKey: string): ParsedPositionRoutingKey | null {
  const parts = routingKey.split('.');
  if (parts.length !== 5 || parts[0] !== 'positions') {
    return null;
  }
  const [, action, protocol, chainIdStr, nftId] = parts;
  if (!action || !protocol || !chainIdStr || !nftId) {
    return null;
  }
  return {
    action,
    protocol,
    chainId: parseInt(chainIdStr, 10),
    nftId,
  };
}

/**
 * Build a routing key for order events (legacy format)
 *
 * @param entityId - Order ID
 * @param eventSuffix - Event type suffix (e.g., 'cancelled')
 * @returns Routing key (e.g., 'order.abc123.cancelled')
 */
export function buildOrderRoutingKey(entityId: string, eventSuffix: string): string {
  return `order.${entityId}.${eventSuffix}`;
}

/**
 * Extract event type suffix from a domain event type
 *
 * @param eventType - Full event type (e.g., 'position.closed', 'order.cancelled')
 * @returns Event suffix (e.g., 'closed', 'cancelled')
 */
export function getEventSuffix(eventType: string): string {
  const parts = eventType.split('.');
  return parts.slice(1).join('.');
}

/**
 * @deprecated Use buildPositionRoutingKey or buildOrderRoutingKey instead
 */
export function buildRoutingKey(
  entityType: 'position' | 'order',
  entityId: string,
  eventSuffix: string
): string {
  return `${entityType}.${entityId}.${eventSuffix}`;
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
