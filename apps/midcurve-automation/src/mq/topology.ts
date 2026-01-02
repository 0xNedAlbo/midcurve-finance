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
  /** Direct exchange for contract deployment events */
  DEPLOYMENTS: 'automation.deployments',
} as const;

/** Queue names */
export const QUEUES = {
  /** Queue for orders ready for execution (competing consumers) */
  ORDERS_PENDING: 'orders.pending',
  /** Queue for contracts ready for deployment */
  CONTRACTS_PENDING: 'contracts.pending',
} as const;

/** Routing keys */
export const ROUTING_KEYS = {
  /** Routing key for triggered orders */
  ORDER_TRIGGERED: 'triggered',
  /** Routing key for contract deployment */
  CONTRACT_DEPLOY: 'deploy',
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
 * - automation.deployments (direct exchange)
 * - orders.pending queue (bound to automation.triggers)
 * - contracts.pending queue (bound to automation.deployments)
 */
export async function setupAutomationTopology(channel: Channel): Promise<void> {
  log.info({ msg: 'Setting up automation topology...' });

  // Create exchanges
  await channel.assertExchange(EXCHANGES.TRIGGERS, 'direct', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGES.TRIGGERS, type: 'direct', msg: 'Exchange declared' });

  await channel.assertExchange(EXCHANGES.DEPLOYMENTS, 'direct', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGES.DEPLOYMENTS, type: 'direct', msg: 'Exchange declared' });

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

  // Create contracts.pending queue
  await channel.assertQueue(QUEUES.CONTRACTS_PENDING, {
    durable: true,
    exclusive: false,
    autoDelete: false,
  });
  log.info({ queue: QUEUES.CONTRACTS_PENDING, msg: 'Queue declared' });

  // Bind contracts.pending to deployments exchange
  await channel.bindQueue(
    QUEUES.CONTRACTS_PENDING,
    EXCHANGES.DEPLOYMENTS,
    ROUTING_KEYS.CONTRACT_DEPLOY
  );
  log.info({
    exchange: EXCHANGES.DEPLOYMENTS,
    queue: QUEUES.CONTRACTS_PENDING,
    routingKey: ROUTING_KEYS.CONTRACT_DEPLOY,
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
    await channel.checkExchange(EXCHANGES.DEPLOYMENTS);
    await channel.checkQueue(QUEUES.ORDERS_PENDING);
    await channel.checkQueue(QUEUES.CONTRACTS_PENDING);
    return true;
  } catch {
    return false;
  }
}
