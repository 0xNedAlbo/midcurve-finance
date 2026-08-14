/**
 * Dead-Letter Queue Depths
 *
 * Names the three dead-letter queues in the system and reads their depths. The
 * probe itself lives in @midcurve/services (see queue-depth.ts there, and the
 * channel hazard it exists to avoid); this file is the list and the wiring.
 */

import {
  probeQueueDepths,
  DOMAIN_QUEUES,
  QUEUE_CLOSE_ORDER_EVENTS_DLQ,
  type QueueDepth,
} from '@midcurve/services';
import { getRabbitMQConnection } from './connection-manager';
import { QUEUES } from './topology';

/**
 * Every dead-letter queue in the system, whoever declares it.
 *
 * Automation declares only the first. The other two belong to business-logic
 * and to the shared domain-events topology, and automation deliberately does
 * not declare them to make this probe convenient — that would couple the
 * services and would paper over the case the probe has to survive, which is a
 * queue that does not exist yet.
 */
export const DEAD_LETTER_QUEUES: readonly string[] = [
  QUEUES.ORDERS_DLQ,
  DOMAIN_QUEUES.DLQ,
  QUEUE_CLOSE_ORDER_EVENTS_DLQ,
];

/**
 * Depth of each dead-letter queue. A queue that does not exist reads as
 * `messages: null` rather than zero.
 */
export async function probeDeadLetterQueues(): Promise<QueueDepth[]> {
  const mq = getRabbitMQConnection();
  return probeQueueDepths(() => mq.createProbeChannel(), DEAD_LETTER_QUEUES);
}
