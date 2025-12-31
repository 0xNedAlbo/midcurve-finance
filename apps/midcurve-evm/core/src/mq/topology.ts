/**
 * RabbitMQ Topology Setup Module
 *
 * Declares exchanges, queues, and bindings for the Core orchestrator.
 * All operations are idempotent - safe to call multiple times.
 */

import type { Channel } from 'amqplib';

// ============================================================
// Constants
// ============================================================

/** Exchange names */
export const EXCHANGES = {
  /** Topic exchange for external events (OHLC, actions, lifecycle) */
  EVENTS: 'midcurve.events',
  /** Direct exchange for effect requests to executor pool */
  EFFECTS: 'midcurve.effects',
  /** Direct exchange for effect results back to strategy loops */
  RESULTS: 'midcurve.results',
} as const;

/** Queue name patterns */
export const QUEUES = {
  /** Shared queue for pending effects (competing consumers) */
  EFFECTS_PENDING: 'effects.pending',
  /** Per-strategy queue for external events */
  strategyEvents: (addr: string) => `strategy.${addr.toLowerCase()}.events`,
  /** Per-strategy queue for effect results */
  strategyResults: (addr: string) => `strategy.${addr.toLowerCase()}.results`,
} as const;

/** Routing key patterns */
export const ROUTING_KEYS = {
  /** Routing key for effects.pending queue */
  EFFECTS_PENDING: 'pending',
  /** Action event routing key pattern */
  action: (addr: string) => `action.${addr.toLowerCase()}`,
  /** Lifecycle event routing key pattern */
  lifecycle: (addr: string) => `lifecycle.${addr.toLowerCase()}`,
  /** Funding event routing key pattern (from vault watcher) */
  funding: (addr: string) => `funding.${addr.toLowerCase()}`,
  /** OHLC data routing key pattern */
  ohlc: (symbol: string, timeframe: string) =>
    `ohlc.${symbol.toUpperCase()}.${timeframe}`,
} as const;

// ============================================================
// Core Topology Setup
// ============================================================

/**
 * Setup core exchanges and queues.
 * Called once on orchestrator startup.
 *
 * Creates:
 * - midcurve.events (topic exchange)
 * - midcurve.effects (direct exchange)
 * - midcurve.results (direct exchange)
 * - effects.pending queue (bound to midcurve.effects)
 */
export async function setupCoreTopology(channel: Channel): Promise<void> {
  console.log('[Topology] Setting up core topology...');

  // Create exchanges
  await channel.assertExchange(EXCHANGES.EVENTS, 'topic', {
    durable: true,
    autoDelete: false,
  });
  console.log(`[Topology] Exchange declared: ${EXCHANGES.EVENTS} (topic)`);

  await channel.assertExchange(EXCHANGES.EFFECTS, 'direct', {
    durable: true,
    autoDelete: false,
  });
  console.log(`[Topology] Exchange declared: ${EXCHANGES.EFFECTS} (direct)`);

  await channel.assertExchange(EXCHANGES.RESULTS, 'direct', {
    durable: true,
    autoDelete: false,
  });
  console.log(`[Topology] Exchange declared: ${EXCHANGES.RESULTS} (direct)`);

  // Create effects.pending queue
  await channel.assertQueue(QUEUES.EFFECTS_PENDING, {
    durable: true,
    exclusive: false,
    autoDelete: false,
  });
  console.log(`[Topology] Queue declared: ${QUEUES.EFFECTS_PENDING}`);

  // Bind effects.pending to effects exchange
  await channel.bindQueue(
    QUEUES.EFFECTS_PENDING,
    EXCHANGES.EFFECTS,
    ROUTING_KEYS.EFFECTS_PENDING
  );
  console.log(
    `[Topology] Binding: ${EXCHANGES.EFFECTS} -> ${QUEUES.EFFECTS_PENDING} (key: ${ROUTING_KEYS.EFFECTS_PENDING})`
  );

  console.log('[Topology] Core topology setup complete');
}

// ============================================================
// Per-Strategy Topology
// ============================================================

/**
 * Setup per-strategy queues and bindings.
 * Called when deploying a new strategy.
 *
 * Creates:
 * - strategy.{addr}.events queue (bound to midcurve.events for action/lifecycle)
 * - strategy.{addr}.results queue (bound to midcurve.results)
 */
export async function setupStrategyTopology(
  channel: Channel,
  strategyAddress: string
): Promise<void> {
  const addr = strategyAddress.toLowerCase();
  console.log(`[Topology] Setting up topology for strategy ${addr}...`);

  const eventsQueue = QUEUES.strategyEvents(addr);
  const resultsQueue = QUEUES.strategyResults(addr);

  // Create events queue
  await channel.assertQueue(eventsQueue, {
    durable: true,
    exclusive: false,
    autoDelete: false,
  });
  console.log(`[Topology] Queue declared: ${eventsQueue}`);

  // Create results queue
  await channel.assertQueue(resultsQueue, {
    durable: true,
    exclusive: false,
    autoDelete: false,
  });
  console.log(`[Topology] Queue declared: ${resultsQueue}`);

  // Bind events queue to events exchange for action messages
  const actionKey = ROUTING_KEYS.action(addr);
  await channel.bindQueue(eventsQueue, EXCHANGES.EVENTS, actionKey);
  console.log(
    `[Topology] Binding: ${EXCHANGES.EVENTS} -> ${eventsQueue} (key: ${actionKey})`
  );

  // Bind events queue to events exchange for lifecycle messages
  const lifecycleKey = ROUTING_KEYS.lifecycle(addr);
  await channel.bindQueue(eventsQueue, EXCHANGES.EVENTS, lifecycleKey);
  console.log(
    `[Topology] Binding: ${EXCHANGES.EVENTS} -> ${eventsQueue} (key: ${lifecycleKey})`
  );

  // Bind events queue to events exchange for funding messages
  const fundingKey = ROUTING_KEYS.funding(addr);
  await channel.bindQueue(eventsQueue, EXCHANGES.EVENTS, fundingKey);
  console.log(
    `[Topology] Binding: ${EXCHANGES.EVENTS} -> ${eventsQueue} (key: ${fundingKey})`
  );

  // Bind results queue to results exchange
  await channel.bindQueue(resultsQueue, EXCHANGES.RESULTS, addr);
  console.log(
    `[Topology] Binding: ${EXCHANGES.RESULTS} -> ${resultsQueue} (key: ${addr})`
  );

  console.log(`[Topology] Strategy topology setup complete for ${addr}`);
}

// ============================================================
// OHLC Subscription Management
// ============================================================

/**
 * Add OHLC subscription binding for a strategy.
 * Called when strategy subscribes to OHLC data.
 *
 * Creates binding: midcurve.events -> strategy.{addr}.events
 * with routing key: ohlc.{SYMBOL}.{timeframe}
 */
export async function bindOhlcSubscription(
  channel: Channel,
  strategyAddress: string,
  symbol: string,
  timeframe: string
): Promise<void> {
  const addr = strategyAddress.toLowerCase();
  const eventsQueue = QUEUES.strategyEvents(addr);
  const routingKey = ROUTING_KEYS.ohlc(symbol, timeframe);

  await channel.bindQueue(eventsQueue, EXCHANGES.EVENTS, routingKey);
  console.log(
    `[Topology] OHLC binding added: ${EXCHANGES.EVENTS} -> ${eventsQueue} (key: ${routingKey})`
  );
}

/**
 * Remove OHLC subscription binding.
 * Called when strategy unsubscribes.
 */
export async function unbindOhlcSubscription(
  channel: Channel,
  strategyAddress: string,
  symbol: string,
  timeframe: string
): Promise<void> {
  const addr = strategyAddress.toLowerCase();
  const eventsQueue = QUEUES.strategyEvents(addr);
  const routingKey = ROUTING_KEYS.ohlc(symbol, timeframe);

  await channel.unbindQueue(eventsQueue, EXCHANGES.EVENTS, routingKey);
  console.log(
    `[Topology] OHLC binding removed: ${EXCHANGES.EVENTS} -> ${eventsQueue} (key: ${routingKey})`
  );
}

// ============================================================
// Cleanup
// ============================================================

/**
 * Cleanup strategy queues on shutdown/removal.
 *
 * Deletes:
 * - strategy.{addr}.events queue
 * - strategy.{addr}.results queue
 *
 * Note: Bindings are automatically removed when queues are deleted.
 */
export async function teardownStrategyTopology(
  channel: Channel,
  strategyAddress: string
): Promise<void> {
  const addr = strategyAddress.toLowerCase();
  console.log(`[Topology] Tearing down topology for strategy ${addr}...`);

  const eventsQueue = QUEUES.strategyEvents(addr);
  const resultsQueue = QUEUES.strategyResults(addr);

  try {
    await channel.deleteQueue(eventsQueue);
    console.log(`[Topology] Queue deleted: ${eventsQueue}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Topology] Failed to delete ${eventsQueue}: ${message}`);
  }

  try {
    await channel.deleteQueue(resultsQueue);
    console.log(`[Topology] Queue deleted: ${resultsQueue}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Topology] Failed to delete ${resultsQueue}: ${message}`);
  }

  console.log(`[Topology] Strategy topology teardown complete for ${addr}`);
}

// ============================================================
// Utilities
// ============================================================

/**
 * Check if core topology exists by querying exchanges.
 * Returns true if all core exchanges exist.
 */
export async function verifyCoreTopology(channel: Channel): Promise<boolean> {
  try {
    // checkExchange throws if exchange doesn't exist
    await channel.checkExchange(EXCHANGES.EVENTS);
    await channel.checkExchange(EXCHANGES.EFFECTS);
    await channel.checkExchange(EXCHANGES.RESULTS);
    await channel.checkQueue(QUEUES.EFFECTS_PENDING);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if strategy topology exists.
 * Returns true if strategy queues exist.
 */
export async function verifyStrategyTopology(
  channel: Channel,
  strategyAddress: string
): Promise<boolean> {
  const addr = strategyAddress.toLowerCase();
  try {
    await channel.checkQueue(QUEUES.strategyEvents(addr));
    await channel.checkQueue(QUEUES.strategyResults(addr));
    return true;
  } catch {
    return false;
  }
}
