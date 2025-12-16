/**
 * Step Event Consumer
 *
 * Consumes external events from the strategy's events queue.
 * Used by the strategy loop to receive OHLC data, user actions, and lifecycle events.
 */

import type { Channel, GetMessage } from 'amqplib';
import { QUEUES } from './topology.js';
import {
  type StepEventMessage,
  deserializeMessage,
  isStepEventMessage,
} from './messages.js';

/**
 * Result of consuming an event from the events queue.
 */
export interface ConsumedEvent {
  /** The parsed step event message */
  message: StepEventMessage;
  /** RabbitMQ delivery tag for ACK/NACK */
  deliveryTag: number;
}

/**
 * Try to consume an event from the strategy's events queue (non-blocking).
 *
 * Uses channel.get() which returns immediately with null if queue is empty.
 *
 * @param channel - RabbitMQ channel
 * @param strategyAddress - Strategy address to consume events for
 * @returns ConsumedEvent if message available, null if queue empty
 */
export async function tryConsumeEvent(
  channel: Channel,
  strategyAddress: string
): Promise<ConsumedEvent | null> {
  const queue = QUEUES.strategyEvents(strategyAddress);

  const msg = await channel.get(queue, { noAck: false });

  if (msg === false) {
    // Queue is empty
    return null;
  }

  return parseEventMessage(msg, queue);
}

/**
 * Consume an event from the strategy's events queue (blocking).
 *
 * Uses Promise wrapper around channel.consume() to wait for a message.
 * This is the main entry point for the strategy loop when waiting for work.
 *
 * @param channel - RabbitMQ channel
 * @param strategyAddress - Strategy address to consume events for
 * @param timeoutMs - Optional timeout in milliseconds (0 = no timeout)
 * @returns ConsumedEvent when message arrives
 * @throws Error on timeout or invalid message
 */
export async function consumeEvent(
  channel: Channel,
  strategyAddress: string,
  timeoutMs = 0
): Promise<ConsumedEvent> {
  const queue = QUEUES.strategyEvents(strategyAddress);

  return new Promise((resolve, reject) => {
    let consumerTag: string | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Setup timeout if specified
    if (timeoutMs > 0) {
      timeoutId = setTimeout(async () => {
        if (consumerTag) {
          await channel.cancel(consumerTag);
        }
        reject(
          new Error(
            `Timeout waiting for event after ${timeoutMs}ms: queue=${queue}`
          )
        );
      }, timeoutMs);
    }

    // Start consuming
    channel
      .consume(
        queue,
        async (msg) => {
          if (msg === null) {
            // Consumer was cancelled
            return;
          }

          // Clear timeout
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          // Cancel consumer (we only want one message)
          if (consumerTag) {
            await channel.cancel(consumerTag);
          }

          try {
            const event = parseEventMessage(msg, queue);
            resolve(event);
          } catch (err) {
            reject(err);
          }
        },
        { noAck: false }
      )
      .then((response) => {
        consumerTag = response.consumerTag;
      })
      .catch(reject);
  });
}

/**
 * Acknowledge a consumed event message.
 *
 * @param channel - RabbitMQ channel
 * @param deliveryTag - Delivery tag from ConsumedEvent
 */
export function ackEvent(channel: Channel, deliveryTag: number): void {
  channel.ack({ fields: { deliveryTag } } as GetMessage);
  console.log(`[EventConsumer] ACK event: deliveryTag=${deliveryTag}`);
}

/**
 * Negative acknowledge a consumed event message (requeue for retry).
 *
 * @param channel - RabbitMQ channel
 * @param deliveryTag - Delivery tag from ConsumedEvent
 * @param requeue - Whether to requeue the message (default: true)
 */
export function nackEvent(
  channel: Channel,
  deliveryTag: number,
  requeue = true
): void {
  channel.nack({ fields: { deliveryTag } } as GetMessage, false, requeue);
  console.log(
    `[EventConsumer] NACK event: deliveryTag=${deliveryTag} requeue=${requeue}`
  );
}

/**
 * Parse and validate a RabbitMQ message as a StepEventMessage.
 */
function parseEventMessage(msg: GetMessage, queue: string): ConsumedEvent {
  let parsed: unknown;
  try {
    parsed = deserializeMessage(msg.content);
  } catch (err) {
    throw new Error(
      `Invalid JSON in event message: queue=${queue} error=${err}`
    );
  }

  if (!isStepEventMessage(parsed)) {
    throw new Error(
      `Invalid step event message format: queue=${queue} content=${JSON.stringify(parsed)}`
    );
  }

  console.log(
    `[EventConsumer] Received event: ` +
      `type=${parsed.eventType.slice(0, 10)}... ` +
      `version=${parsed.eventVersion} ` +
      `source=${parsed.source} ` +
      `timestamp=${new Date(parsed.timestamp).toISOString()}`
  );

  return {
    message: parsed,
    deliveryTag: msg.fields.deliveryTag,
  };
}

/**
 * Publish a step event to the events exchange.
 * Used for testing and external event sources.
 *
 * @param channel - RabbitMQ channel
 * @param routingKey - Routing key (e.g., 'action.0x1234', 'ohlc.ETH-USDC.5m')
 * @param event - Step event message
 * @returns true if published successfully
 */
export function publishEvent(
  channel: Channel,
  routingKey: string,
  event: StepEventMessage
): boolean {
  const buffer = Buffer.from(JSON.stringify(event));

  const published = channel.publish('midcurve.events', routingKey, buffer, {
    persistent: true,
    contentType: 'application/json',
    contentEncoding: 'utf-8',
    timestamp: event.timestamp,
    headers: {
      eventType: event.eventType,
      source: event.source,
    },
  });

  if (published) {
    console.log(
      `[EventConsumer] Published event: routingKey=${routingKey} type=${event.eventType.slice(0, 10)}...`
    );
  }

  return published;
}
