/**
 * RabbitMQ Topology Setup
 *
 * Declares exchanges, queues, and bindings for the automation service.
 * All operations are idempotent - safe to call multiple times.
 */

import type { Channel } from 'amqplib';
import { EXCHANGE_CLOSE_ORDER_EVENTS, DLQ_MESSAGE_TTL_MS } from '@midcurve/services';
import { automationLogger } from '../lib/logger';

const log = automationLogger.child({ component: 'Topology' });

// ============================================================
// Constants
// ============================================================

/** Exchange names */
export const EXCHANGES = {
  /** Direct exchange for order trigger events */
  TRIGGERS: 'automation.triggers',
  /**
   * Dead-letter exchange for triggered orders that cannot be processed.
   *
   * Deliberately not domain-events-dlx. That exchange carries domain events;
   * these are commands on a direct exchange, and a queue named
   * domain.events.dlq holding trigger commands would mislead whoever opens it.
   */
  ORDERS_DLX: 'automation.orders-dlx',
} as const;

/** Queue names */
export const QUEUES = {
  /**
   * Queue for orders ready for execution (competing consumers).
   *
   * v2: the v1 queue was declared without a dead-letter exchange, so a trigger
   * the executor could not deserialize was nacked with requeue=false and
   * discarded by the broker outright — no retention, no record, one log line.
   * This is the queue carrying "a position hit its stop, close it", so that was
   * the one discard path in the system with money on the other end of it.
   *
   * Queue arguments are immutable in RabbitMQ, so adding the DLX means declaring
   * a new queue. Same reason as the v2 rename at
   * uniswapv3-process-close-order-events.ts, and the deploy shape is the same —
   * but one piece of its reasoning does not transfer. See below.
   *
   * DEPLOY STEP — the v1 queue does not drain, it fills. `orders.pending` is
   * durable, autoDelete: false, and still bound to automation.triggers on
   * routing key `triggered`. A direct exchange delivers to every queue bound
   * with that key, so v1 keeps receiving every trigger with nobody consuming it.
   *
   * READ THIS BEFORE ACTING ON THE DEPTH — unlike the close-order precedent,
   * a non-empty v1 queue here does NOT mean unprocessed messages. During a
   * rolling deploy both queues are bound to `triggered` and both receive every
   * trigger: v2 executes it, v1 accumulates a copy of a trigger that has
   * already been executed. Shovelling v1 into v2 therefore replays executed
   * triggers. The CAS in atomicTransitionToExecuting() stops a double
   * execution, so this is unlikely to cause damage — but the operator would be
   * acting on a false reading, and the next case may not have a CAS behind it.
   * Compare the timestamps in the messages against execution history before
   * deciding anything; discarding is the expected outcome here.
   *
   * Two phases, in this order. The first is reversible and stops the bleeding;
   * the second needs a human looking at the queue depth.
   *
   *   1. Unbind — accumulation stops immediately, nothing is lost:
   *      rabbitmqadmin delete binding source=automation.triggers \
   *        destination=orders.pending destination_type=queue \
   *        properties_key='triggered'
   *
   *   2. Check the depth, then decide:
   *      rabbitmqadmin list queues name messages
   *      Empty → delete it. Non-empty → read the paragraph above before
   *      shovelling anything anywhere.
   *      rabbitmqadmin delete queue name=orders.pending
   *
   * Not done from code on purpose: the unbind would be safe to automate, but
   * collapsing it together with the delete would hide an irreversible action
   * behind a reversible one, and mid-rolling-deploy is the worst moment for the
   * code to decide what happens to unprocessed triggers.
   *
   * orders.retry-delay needs no action across this rename. It dead-letters to
   * automation.triggers with routing key `triggered`, which is bound to v2, so
   * the path stays intact.
   */
  ORDERS_PENDING: 'orders.pending.v2',
  /** Dead-letter queue for triggered orders, 7-day retention */
  ORDERS_DLQ: 'automation.orders.dlq',
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
 * - automation.orders-dlx (fanout exchange for dead-lettered triggers)
 * - automation.orders.dlq (dead-letter queue, 7-day retention)
 * - orders.pending.v2 queue (bound to automation.triggers, dead-letters to the above)
 */
export async function setupAutomationTopology(channel: Channel): Promise<void> {
  log.info({ msg: 'Setting up automation topology...' });

  // Create exchanges
  await channel.assertExchange(EXCHANGES.TRIGGERS, 'direct', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGES.TRIGGERS, type: 'direct', msg: 'Exchange declared' });

  // Dead-letter topology, declared before the queue that points at it.
  await channel.assertExchange(EXCHANGES.ORDERS_DLX, 'fanout', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGES.ORDERS_DLX, type: 'fanout', msg: 'Exchange declared' });

  await channel.assertQueue(QUEUES.ORDERS_DLQ, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: {
      'x-message-ttl': DLQ_MESSAGE_TTL_MS,
    },
  });
  log.info({ queue: QUEUES.ORDERS_DLQ, ttlMs: DLQ_MESSAGE_TTL_MS, msg: 'Queue declared' });

  await channel.bindQueue(QUEUES.ORDERS_DLQ, EXCHANGES.ORDERS_DLX, '');
  log.info({
    exchange: EXCHANGES.ORDERS_DLX,
    queue: QUEUES.ORDERS_DLQ,
    msg: 'Queue bound to exchange',
  });

  // Create orders.pending queue
  await channel.assertQueue(QUEUES.ORDERS_PENDING, {
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: {
      'x-dead-letter-exchange': EXCHANGES.ORDERS_DLX,
    },
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

  // Assert close-order-events exchange (executor publishes execution receipts)
  await channel.assertExchange(EXCHANGE_CLOSE_ORDER_EVENTS, 'topic', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGE_CLOSE_ORDER_EVENTS, type: 'topic', msg: 'Exchange declared' });

  log.info({ msg: 'Automation topology setup complete' });
}

// There was a verifyAutomationTopology() here — the exact twin of
// verifyDomainEventsTopology() in @midcurve/services, deleted in the same pass
// and for the same reason. Both were exported, called from nowhere, and both
// ran passive declares on a caller-supplied channel: against a fresh broker
// they would report "topology missing" while destroying the channel and its
// consumers, and the `catch` could not tell that from a broker being down.
//
// If something needs to know whether a queue exists, probeQueueDepths() in
// @midcurve/services asks that question on a channel of its own. See #82.
