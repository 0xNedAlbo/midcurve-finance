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
} as const;

/**
 * Routing key patterns for domain events
 * Uses RabbitMQ topic exchange pattern matching:
 * - `*` matches exactly one word
 * - `#` matches zero or more words
 *
 * Position event routing key format:
 *   positions.{action}.{positionType}
 *   e.g., positions.created.uniswapv3
 *
 * Order event routing key format:
 *   orders.{action}.{orderId}
 *   e.g., orders.triggered.abc123
 */
export const ROUTING_PATTERNS = {
  // Position events: positions.{action}.{positionType}
  /** All position created events */
  POSITION_CREATED: 'positions.created.#',
  /** All position closed events */
  POSITION_CLOSED: 'positions.closed.#',
  /** All position burned events (destroyed on-chain) */
  POSITION_BURNED: 'positions.burned.#',
  /** All position deleted events */
  POSITION_DELETED: 'positions.deleted.#',
  /** All position liquidity increased events */
  POSITION_LIQUIDITY_INCREASED: 'positions.liquidity-increased.#',
  /** All position liquidity decreased events */
  POSITION_LIQUIDITY_DECREASED: 'positions.liquidity-decreased.#',
  /** All position fees collected events */
  POSITION_FEES_COLLECTED: 'positions.fees-collected.#',
  /** All position liquidity reverted events (chain reorgs) */
  POSITION_LIQUIDITY_REVERTED: 'positions.liquidity-reverted.#',
  /** All position transferred in events */
  POSITION_TRANSFERRED_IN: 'positions.transferred-in.#',
  /** All position transferred out events */
  POSITION_TRANSFERRED_OUT: 'positions.transferred-out.#',
  /** All position events */
  ALL_POSITION_EVENTS: 'positions.#',

  // User events: users.{action}.{userId}
  /** All user registered events */
  USER_REGISTERED: 'users.registered.#',
  /** All user events */
  ALL_USER_EVENTS: 'users.#',

  // Wallet events: wallets.{action}.{userId}
  /** All wallet added events */
  WALLET_ADDED: 'wallets.added.#',
  /** All wallet removed events */
  WALLET_REMOVED: 'wallets.removed.#',
  /** All wallet events */
  ALL_WALLET_EVENTS: 'wallets.#',

  // Order events (keeping existing format for now)
  /** All order events: order.# */
  ALL_ORDER_EVENTS: 'order.#',
  /** All events: # */
  ALL_EVENTS: '#',
} as const;

/**
 * Map from event type to routing key action
 */
const POSITION_EVENT_TO_ACTION: Record<string, string> = {
  'position.created': 'created',
  'position.closed': 'closed',
  'position.burned': 'burned',
  'position.deleted': 'deleted',
  'position.liquidity.increased': 'liquidity-increased',
  'position.liquidity.decreased': 'liquidity-decreased',
  'position.fees.collected': 'fees-collected',
  'position.liquidity.reverted': 'liquidity-reverted',
  'position.transferred.in': 'transferred-in',
  'position.transferred.out': 'transferred-out',
};

/**
 * Map from user event type to routing key action
 */
const USER_EVENT_TO_ACTION: Record<string, string> = {
  'user.registered': 'registered',
};

/**
 * Map from wallet event type to routing key action
 */
const WALLET_EVENT_TO_ACTION: Record<string, string> = {
  'wallet.added': 'added',
  'wallet.removed': 'removed',
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
 * Build a routing key for wallet events
 *
 * @param eventType - Full event type (e.g., 'wallet.added')
 * @param userId - User ID
 * @returns Routing key (e.g., 'wallets.added.clxyz123abc')
 * @throws Error if event type is unknown
 */
export function buildWalletRoutingKey(eventType: string, userId: string): string {
  const action = WALLET_EVENT_TO_ACTION[eventType];
  if (!action) {
    throw new Error(`Unknown wallet event type: ${eventType}`);
  }
  return `wallets.${action}.${userId}`;
}

/**
 * Extract the position type (first segment) from a positionHash.
 *
 * @param positionHash - Position hash (e.g., 'uniswapv3/42161/12345', 'hyperliquid/mainnet/BTC-USD')
 * @returns Position type (e.g., 'uniswapv3', 'hyperliquid')
 * @throws Error if positionHash is empty or has no segments
 */
export function extractPositionType(positionHash: string): string {
  const slashIndex = positionHash.indexOf('/');
  const positionType = slashIndex === -1 ? positionHash : positionHash.slice(0, slashIndex);
  if (!positionType) {
    throw new Error(`Invalid positionHash: cannot extract position type from "${positionHash}"`);
  }
  return positionType;
}

/**
 * Build a routing key for position events.
 *
 * Routing key format: positions.{action}.{positionType}
 * e.g., positions.created.uniswapv3
 *
 * @param eventType - Full event type (e.g., 'position.created')
 * @param positionHash - Position hash (e.g., 'uniswapv3/42161/12345')
 * @returns Routing key (e.g., 'positions.created.uniswapv3')
 * @throws Error if event type is unknown or positionHash is invalid
 */
export function buildPositionRoutingKey(eventType: string, positionHash: string): string {
  const action = POSITION_EVENT_TO_ACTION[eventType];
  if (!action) {
    throw new Error(`Unknown position event type: ${eventType}`);
  }
  const positionType = extractPositionType(positionHash);
  return `positions.${action}.${positionType}`;
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
