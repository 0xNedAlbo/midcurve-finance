/**
 * Effect Request Publisher
 *
 * Publishes effect requests from Core to the effects.pending queue
 * for consumption by the executor pool.
 */

import type { Channel } from 'amqplib';
import { EXCHANGES, ROUTING_KEYS } from './topology';
import {
  type EffectRequestMessage,
  serializeMessage,
} from './messages';

/**
 * Publish an effect request to the effects exchange.
 *
 * @param channel - RabbitMQ channel
 * @param request - Effect request message
 * @returns true if published successfully, false if channel buffer is full
 */
export function publishEffectRequest(
  channel: Channel,
  request: EffectRequestMessage
): boolean {
  const buffer = serializeMessage(request);

  const published = channel.publish(
    EXCHANGES.EFFECTS,
    ROUTING_KEYS.EFFECTS_PENDING,
    buffer,
    {
      persistent: true, // Survive broker restart
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      timestamp: request.requestedAt,
      correlationId: request.correlationId,
      headers: {
        strategyAddress: request.strategyAddress,
        effectType: request.effectType,
        epoch: request.epoch,
      },
    }
  );

  if (published) {
    console.log(
      `[EffectPublisher] Published effect request: ` +
        `strategy=${request.strategyAddress.slice(0, 10)}... ` +
        `type=${request.effectType.slice(0, 10)}... ` +
        `key=${request.idempotencyKey.slice(0, 10)}... ` +
        `correlationId=${request.correlationId}`
    );
  } else {
    console.warn(
      `[EffectPublisher] Channel buffer full, effect not published: ` +
        `correlationId=${request.correlationId}`
    );
  }

  return published;
}

/**
 * Publish an effect request with retry logic.
 *
 * @param channel - RabbitMQ channel
 * @param request - Effect request message
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param retryDelayMs - Delay between retries in ms (default: 100)
 * @returns true if published successfully
 * @throws Error if all retries fail
 */
export async function publishEffectRequestWithRetry(
  channel: Channel,
  request: EffectRequestMessage,
  maxRetries = 3,
  retryDelayMs = 100
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const published = publishEffectRequest(channel, request);
    if (published) {
      return true;
    }

    if (attempt < maxRetries) {
      console.log(
        `[EffectPublisher] Retry ${attempt}/${maxRetries} in ${retryDelayMs}ms...`
      );
      await sleep(retryDelayMs);
      // Exponential backoff
      retryDelayMs *= 2;
    }
  }

  throw new Error(
    `Failed to publish effect request after ${maxRetries} attempts: ` +
      `correlationId=${request.correlationId}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
