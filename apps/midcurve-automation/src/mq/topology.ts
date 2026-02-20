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
} as const;

/** Queue names */
export const QUEUES = {
  /** Queue for orders ready for execution (competing consumers) */
  ORDERS_PENDING: 'orders.pending',
} as const;

/** Retry delay in milliseconds (60 seconds) */
export const ORDER_RETRY_DELAY_MS = 60_000;

/** Routing keys */
export const ROUTING_KEYS = {
  /** Routing key for triggered orders */
  ORDER_TRIGGERED: 'triggered',
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
 * - orders.pending queue (bound to automation.triggers)
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

  log.info({ msg: 'Automation topology setup complete' });
}

/**
 * Verify automation topology exists.
 * Returns true if all exchanges and queues exist.
 */
export async function verifyAutomationTopology(channel: Channel): Promise<boolean> {
  try {
    await channel.checkExchange(EXCHANGES.TRIGGERS);
    await channel.checkQueue(QUEUES.ORDERS_PENDING);
    return true;
  } catch {
    return false;
  }
}
