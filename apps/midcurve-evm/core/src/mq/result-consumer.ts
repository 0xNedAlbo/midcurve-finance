/**
 * Effect Result Consumer
 *
 * Consumes effect results from the strategy's results queue.
 * Used by the strategy loop to receive completed effect data.
 */

import type { Channel, GetMessage } from 'amqplib';
import { QUEUES } from './topology.js';
import {
  type EffectResultMessage,
  deserializeMessage,
  isEffectResultMessage,
} from './messages.js';

/**
 * Result of consuming a message from the results queue.
 */
export interface ConsumedResult {
  /** The parsed effect result message */
  message: EffectResultMessage;
  /** RabbitMQ delivery tag for ACK/NACK */
  deliveryTag: number;
}

/**
 * Try to consume a result from the strategy's results queue (non-blocking).
 *
 * Uses channel.get() which returns immediately with null if queue is empty.
 * This is the priority check - we want to drain results before processing events.
 *
 * @param channel - RabbitMQ channel
 * @param strategyAddress - Strategy address to consume results for
 * @returns ConsumedResult if message available, null if queue empty
 */
export async function tryConsumeResult(
  channel: Channel,
  strategyAddress: string
): Promise<ConsumedResult | null> {
  const queue = QUEUES.strategyResults(strategyAddress);

  const msg = await channel.get(queue, { noAck: false });

  if (msg === false) {
    // Queue is empty
    return null;
  }

  return parseResultMessage(msg, queue);
}

/**
 * Consume a result from the strategy's results queue (blocking).
 *
 * Uses Promise wrapper around channel.consume() to wait for a message.
 * Use this when you know there's a pending effect and want to wait for it.
 *
 * @param channel - RabbitMQ channel
 * @param strategyAddress - Strategy address to consume results for
 * @param timeoutMs - Optional timeout in milliseconds (0 = no timeout)
 * @returns ConsumedResult when message arrives
 * @throws Error on timeout or invalid message
 */
export async function consumeResult(
  channel: Channel,
  strategyAddress: string,
  timeoutMs = 0
): Promise<ConsumedResult> {
  const queue = QUEUES.strategyResults(strategyAddress);

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
            `Timeout waiting for effect result after ${timeoutMs}ms: queue=${queue}`
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
            const result = parseResultMessage(msg, queue);
            resolve(result);
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
 * Acknowledge a consumed result message.
 *
 * @param channel - RabbitMQ channel
 * @param deliveryTag - Delivery tag from ConsumedResult
 */
export function ackResult(channel: Channel, deliveryTag: number): void {
  channel.ack({ fields: { deliveryTag } } as GetMessage);
  console.log(`[ResultConsumer] ACK result: deliveryTag=${deliveryTag}`);
}

/**
 * Negative acknowledge a consumed result message (requeue for retry).
 *
 * @param channel - RabbitMQ channel
 * @param deliveryTag - Delivery tag from ConsumedResult
 * @param requeue - Whether to requeue the message (default: true)
 */
export function nackResult(
  channel: Channel,
  deliveryTag: number,
  requeue = true
): void {
  channel.nack({ fields: { deliveryTag } } as GetMessage, false, requeue);
  console.log(
    `[ResultConsumer] NACK result: deliveryTag=${deliveryTag} requeue=${requeue}`
  );
}

/**
 * Parse and validate a RabbitMQ message as an EffectResultMessage.
 */
function parseResultMessage(
  msg: GetMessage,
  queue: string
): ConsumedResult {
  let parsed: unknown;
  try {
    parsed = deserializeMessage(msg.content);
  } catch (err) {
    throw new Error(
      `Invalid JSON in result message: queue=${queue} error=${err}`
    );
  }

  if (!isEffectResultMessage(parsed)) {
    throw new Error(
      `Invalid effect result message format: queue=${queue} content=${JSON.stringify(parsed)}`
    );
  }

  const elapsedMs = parsed.completedAt - parsed.requestedAt;
  console.log(
    `[ResultConsumer] Received result: ` +
      `strategy=${parsed.strategyAddress.slice(0, 10)}... ` +
      `key=${parsed.idempotencyKey.slice(0, 10)}... ` +
      `ok=${parsed.ok} ` +
      `elapsed=${elapsedMs}ms ` +
      `correlationId=${parsed.correlationId}`
  );

  return {
    message: parsed,
    deliveryTag: msg.fields.deliveryTag,
  };
}
