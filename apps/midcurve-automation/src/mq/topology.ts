/**
 * RabbitMQ Topology Setup
 *
 * Declares exchanges, queues, and bindings for the automation service.
 * All operations are idempotent - safe to call multiple times.
 */

import type { Channel } from 'amqplib';
import { automationLogger } from '../lib/logger';

const log = automationLogger.child({ component: 'Topology' });

// ============================================================
// Constants
// ============================================================

/** Exchange names */
export const EXCHANGES = {
  /** Direct exchange for order trigger events */
  TRIGGERS: 'automation.triggers',
  /** Direct exchange for notification events */
  NOTIFICATIONS: 'automation.notifications',
} as const;

/** Queue names */
export const QUEUES = {
  /** Queue for orders ready for execution (competing consumers) */
  ORDERS_PENDING: 'orders.pending',
  /** Delay queue for order retries (60s TTL, dead-letters back to orders.pending) */
  ORDERS_RETRY_DELAY: 'orders.retry-delay',
  /** Queue for pending notifications to be processed */
  NOTIFICATIONS_PENDING: 'notifications.pending',
  /** Queue for hedge vault triggers ready for execution */
  HEDGE_VAULT_PENDING: 'hedge.vault.pending',
  /** Delay queue for hedge vault retries (60s TTL, dead-letters back to hedge.vault.pending) */
  HEDGE_VAULT_RETRY_DELAY: 'hedge.vault.retry-delay',
} as const;

/** Retry delay in milliseconds (60 seconds) */
export const ORDER_RETRY_DELAY_MS = 60000;

/** Routing keys */
export const ROUTING_KEYS = {
  /** Routing key for triggered orders */
  ORDER_TRIGGERED: 'triggered',
  /** Routing key for position range change notifications */
  NOTIFICATION_RANGE_CHANGE: 'range.change',
  /** Routing key for order execution result notifications */
  NOTIFICATION_EXECUTION_RESULT: 'execution.result',
  /** Routing key for hedge vault triggers (SIL/TIP/Reopen) */
  HEDGE_VAULT_TRIGGERED: 'hedge.triggered',
  /** Routing key for hedge vault execution result notifications */
  NOTIFICATION_HEDGE_VAULT_RESULT: 'hedge.result',
} as const;

// ============================================================
// Topology Setup
// ============================================================

/**
 * Setup automation topology.
 * Called once on service startup.
 *
 * Creates:
 * - automation.triggers (direct exchange)
 * - automation.notifications (direct exchange)
 * - orders.pending queue (bound to automation.triggers)
 * - notifications.pending queue (bound to automation.notifications)
 */
export async function setupAutomationTopology(channel: Channel): Promise<void> {
  log.info({ msg: 'Setting up automation topology...' });

  // Create exchanges
  await channel.assertExchange(EXCHANGES.TRIGGERS, 'direct', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGES.TRIGGERS, type: 'direct', msg: 'Exchange declared' });

  // Create orders.pending queue
  await channel.assertQueue(QUEUES.ORDERS_PENDING, {
    durable: true,
    exclusive: false,
    autoDelete: false,
  });
  log.info({ queue: QUEUES.ORDERS_PENDING, msg: 'Queue declared' });

  // Bind orders.pending to triggers exchange
  await channel.bindQueue(
    QUEUES.ORDERS_PENDING,
    EXCHANGES.TRIGGERS,
    ROUTING_KEYS.ORDER_TRIGGERED
  );
  log.info({
    exchange: EXCHANGES.TRIGGERS,
    queue: QUEUES.ORDERS_PENDING,
    routingKey: ROUTING_KEYS.ORDER_TRIGGERED,
    msg: 'Queue bound to exchange',
  });

  // Create orders.retry-delay queue (for delayed retries)
  // Messages in this queue will dead-letter back to orders.pending after TTL expires
  await channel.assertQueue(QUEUES.ORDERS_RETRY_DELAY, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: {
      'x-message-ttl': ORDER_RETRY_DELAY_MS,
      'x-dead-letter-exchange': EXCHANGES.TRIGGERS,
      'x-dead-letter-routing-key': ROUTING_KEYS.ORDER_TRIGGERED,
    },
  });
  log.info({
    queue: QUEUES.ORDERS_RETRY_DELAY,
    ttlMs: ORDER_RETRY_DELAY_MS,
    deadLetterExchange: EXCHANGES.TRIGGERS,
    deadLetterRoutingKey: ROUTING_KEYS.ORDER_TRIGGERED,
    msg: 'Delay queue declared with TTL and dead-letter config',
  });

  // Create notifications exchange
  await channel.assertExchange(EXCHANGES.NOTIFICATIONS, 'direct', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGES.NOTIFICATIONS, type: 'direct', msg: 'Exchange declared' });

  // Create notifications.pending queue
  await channel.assertQueue(QUEUES.NOTIFICATIONS_PENDING, {
    durable: true,
    exclusive: false,
    autoDelete: false,
  });
  log.info({ queue: QUEUES.NOTIFICATIONS_PENDING, msg: 'Queue declared' });

  // Bind notifications.pending to notifications exchange for range changes
  await channel.bindQueue(
    QUEUES.NOTIFICATIONS_PENDING,
    EXCHANGES.NOTIFICATIONS,
    ROUTING_KEYS.NOTIFICATION_RANGE_CHANGE
  );
  log.info({
    exchange: EXCHANGES.NOTIFICATIONS,
    queue: QUEUES.NOTIFICATIONS_PENDING,
    routingKey: ROUTING_KEYS.NOTIFICATION_RANGE_CHANGE,
    msg: 'Queue bound to exchange',
  });

  // Bind notifications.pending to notifications exchange for execution results
  await channel.bindQueue(
    QUEUES.NOTIFICATIONS_PENDING,
    EXCHANGES.NOTIFICATIONS,
    ROUTING_KEYS.NOTIFICATION_EXECUTION_RESULT
  );
  log.info({
    exchange: EXCHANGES.NOTIFICATIONS,
    queue: QUEUES.NOTIFICATIONS_PENDING,
    routingKey: ROUTING_KEYS.NOTIFICATION_EXECUTION_RESULT,
    msg: 'Queue bound to exchange',
  });

  // Bind notifications.pending to notifications exchange for hedge vault results
  await channel.bindQueue(
    QUEUES.NOTIFICATIONS_PENDING,
    EXCHANGES.NOTIFICATIONS,
    ROUTING_KEYS.NOTIFICATION_HEDGE_VAULT_RESULT
  );
  log.info({
    exchange: EXCHANGES.NOTIFICATIONS,
    queue: QUEUES.NOTIFICATIONS_PENDING,
    routingKey: ROUTING_KEYS.NOTIFICATION_HEDGE_VAULT_RESULT,
    msg: 'Queue bound to exchange',
  });

  // Create hedge.vault.pending queue
  await channel.assertQueue(QUEUES.HEDGE_VAULT_PENDING, {
    durable: true,
    exclusive: false,
    autoDelete: false,
  });
  log.info({ queue: QUEUES.HEDGE_VAULT_PENDING, msg: 'Queue declared' });

  // Bind hedge.vault.pending to triggers exchange
  await channel.bindQueue(
    QUEUES.HEDGE_VAULT_PENDING,
    EXCHANGES.TRIGGERS,
    ROUTING_KEYS.HEDGE_VAULT_TRIGGERED
  );
  log.info({
    exchange: EXCHANGES.TRIGGERS,
    queue: QUEUES.HEDGE_VAULT_PENDING,
    routingKey: ROUTING_KEYS.HEDGE_VAULT_TRIGGERED,
    msg: 'Queue bound to exchange',
  });

  // Create hedge.vault.retry-delay queue (for delayed retries)
  // Messages in this queue will dead-letter back to hedge.vault.pending after TTL expires
  await channel.assertQueue(QUEUES.HEDGE_VAULT_RETRY_DELAY, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: {
      'x-message-ttl': ORDER_RETRY_DELAY_MS,
      'x-dead-letter-exchange': EXCHANGES.TRIGGERS,
      'x-dead-letter-routing-key': ROUTING_KEYS.HEDGE_VAULT_TRIGGERED,
    },
  });
  log.info({
    queue: QUEUES.HEDGE_VAULT_RETRY_DELAY,
    ttlMs: ORDER_RETRY_DELAY_MS,
    deadLetterExchange: EXCHANGES.TRIGGERS,
    deadLetterRoutingKey: ROUTING_KEYS.HEDGE_VAULT_TRIGGERED,
    msg: 'Delay queue declared with TTL and dead-letter config',
  });

  log.info({ msg: 'Automation topology setup complete' });
}

/**
 * Verify automation topology exists.
 * Returns true if all exchanges and queues exist.
 */
export async function verifyAutomationTopology(channel: Channel): Promise<boolean> {
  try {
    await channel.checkExchange(EXCHANGES.TRIGGERS);
    await channel.checkExchange(EXCHANGES.NOTIFICATIONS);
    await channel.checkQueue(QUEUES.ORDERS_PENDING);
    await channel.checkQueue(QUEUES.ORDERS_RETRY_DELAY);
    await channel.checkQueue(QUEUES.NOTIFICATIONS_PENDING);
    await channel.checkQueue(QUEUES.HEDGE_VAULT_PENDING);
    await channel.checkQueue(QUEUES.HEDGE_VAULT_RETRY_DELAY);
    return true;
  } catch {
    return false;
  }
}
