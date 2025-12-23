/**
 * Effect Handler Types
 *
 * Defines the interface for effect handlers that process
 * effect requests from the effects.pending queue.
 */

import type { Channel } from 'amqplib';
import type { Hex } from 'viem';
import type { EffectRequestMessage } from '../../mq/messages';

/**
 * Result returned by an effect handler.
 */
export interface EffectHandlerResult {
  /** Whether the effect executed successfully */
  ok: boolean;
  /** Result data (ABI-encoded, empty '0x' for most effects) */
  data: Hex;
}

/**
 * Interface for effect handlers.
 *
 * Handlers are registered in the EffectHandlerRegistry and
 * dispatched based on the effectType field in the request.
 */
export interface EffectHandler {
  /**
   * The effect type this handler processes (bytes32 hash).
   * Must match the effectType in EffectRequestMessage.
   */
  readonly effectType: Hex;

  /**
   * Human-readable name for logging and debugging.
   */
  readonly name: string;

  /**
   * Execute the effect and return a result.
   *
   * @param request The effect request message from the queue
   * @param channel RabbitMQ channel (for handlers that need it, e.g., OHLC)
   * @returns Result to submit back to the strategy contract
   *
   * @throws Error for transient failures (will be retried via NACK)
   */
  handle(
    request: EffectRequestMessage,
    channel: Channel
  ): Promise<EffectHandlerResult>;
}
