/**
 * Effect Executor
 *
 * Consumes effect requests from the effects.pending queue,
 * executes them via registered handlers, and publishes results
 * back to strategy-specific results queues.
 */

import type { Channel, ConsumeMessage } from 'amqplib';
import type { Hex } from 'viem';
import {
  QUEUES,
  EXCHANGES,
  deserializeMessage,
  serializeMessage,
  isEffectRequestMessage,
  createEffectResult,
  type EffectRequestMessage,
} from '../mq/index.js';
import { EffectHandlerRegistry } from './handlers/registry.js';

// ============================================================
// Types
// ============================================================

export interface ExecutorConfig {
  /** RabbitMQ channel */
  channel: Channel;
  /** Unique executor identifier */
  executorId: string;
  /** Prefetch count (default: 1) */
  prefetch?: number;
}

export interface ExecutorStats {
  /** Number of effects successfully processed */
  processed: number;
  /** Number of effects that failed */
  failed: number;
  /** Whether the executor is currently running */
  running: boolean;
}

// ============================================================
// Executor Class
// ============================================================

/**
 * Single executor that consumes from effects.pending queue.
 *
 * Each executor:
 * - Consumes one message at a time (prefetch=1)
 * - Dispatches to appropriate handler based on effectType
 * - Publishes result to strategy's results queue
 * - ACKs only after successful result publication
 */
export class Executor {
  private config: Required<ExecutorConfig>;
  private registry: EffectHandlerRegistry;
  private consumerTag: string | null = null;
  private running = false;
  private effectsProcessed = 0;
  private effectsFailed = 0;

  constructor(config: ExecutorConfig) {
    this.config = {
      ...config,
      prefetch: config.prefetch ?? 1,
    };
    this.registry = new EffectHandlerRegistry();
  }

  /**
   * Get the handler registry for custom handler registration.
   */
  getRegistry(): EffectHandlerRegistry {
    return this.registry;
  }

  /**
   * Start consuming from effects.pending queue.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Executor already running');
    }

    console.log(`[Executor:${this.config.executorId}] Starting...`);

    // Set prefetch for fair dispatch
    await this.config.channel.prefetch(this.config.prefetch);

    // Start consuming
    const response = await this.config.channel.consume(
      QUEUES.EFFECTS_PENDING,
      (msg) => this.handleMessage(msg),
      { noAck: false }
    );

    this.consumerTag = response.consumerTag;
    this.running = true;

    console.log(
      `[Executor:${this.config.executorId}] Consuming from ${QUEUES.EFFECTS_PENDING}`
    );
  }

  /**
   * Stop consuming and wait for in-flight effects.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log(`[Executor:${this.config.executorId}] Stopping...`);

    if (this.consumerTag) {
      await this.config.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }

    this.running = false;

    console.log(
      `[Executor:${this.config.executorId}] Stopped. ` +
        `Processed: ${this.effectsProcessed}, Failed: ${this.effectsFailed}`
    );
  }

  /**
   * Get executor statistics.
   */
  getStats(): ExecutorStats {
    return {
      processed: this.effectsProcessed,
      failed: this.effectsFailed,
      running: this.running,
    };
  }

  /**
   * Handle incoming message from queue.
   */
  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      return;
    }

    const startTime = Date.now();

    try {
      // Deserialize and validate
      const request = deserializeMessage<EffectRequestMessage>(msg.content);

      if (!isEffectRequestMessage(request)) {
        console.error(
          `[Executor:${this.config.executorId}] Invalid message format, discarding`
        );
        this.config.channel.ack(msg);
        return;
      }

      // Find handler
      const handler = this.registry.get(request.effectType as Hex);

      if (!handler) {
        console.warn(
          `[Executor:${this.config.executorId}] No handler for effect type: ` +
            `${request.effectType.slice(0, 10)}...`
        );
        // ACK with failure result (unknown effect type is permanent error)
        await this.publishFailureResult(request, 'Unknown effect type');
        this.config.channel.ack(msg);
        this.effectsFailed++;
        return;
      }

      // Execute handler
      console.log(
        `[Executor:${this.config.executorId}] Handling ${handler.name}: ` +
          `key=${request.idempotencyKey.slice(0, 10)}...`
      );

      const result = await handler.handle(request, this.config.channel);

      // Publish result
      const resultMessage = createEffectResult(
        request,
        result.ok,
        result.data,
        this.config.executorId
      );

      const published = this.config.channel.publish(
        EXCHANGES.RESULTS,
        request.strategyAddress.toLowerCase(),
        serializeMessage(resultMessage),
        {
          persistent: true,
          contentType: 'application/json',
          correlationId: request.correlationId,
        }
      );

      if (!published) {
        throw new Error('Failed to publish result - channel buffer full');
      }

      // ACK only after successful publish
      this.config.channel.ack(msg);
      this.effectsProcessed++;

      const elapsed = Date.now() - startTime;
      console.log(
        `[Executor:${this.config.executorId}] ${handler.name} completed in ${elapsed}ms ` +
          `(ok=${result.ok})`
      );
    } catch (error) {
      console.error(
        `[Executor:${this.config.executorId}] Handler error:`,
        error
      );

      // NACK with requeue for transient errors
      this.config.channel.nack(msg, false, true);
      this.effectsFailed++;
    }
  }

  /**
   * Publish a failure result for permanent errors.
   */
  private async publishFailureResult(
    request: EffectRequestMessage,
    errorMessage: string
  ): Promise<void> {
    const resultMessage = createEffectResult(
      request,
      false,
      `0x${Buffer.from(errorMessage).toString('hex')}` as Hex,
      this.config.executorId
    );

    this.config.channel.publish(
      EXCHANGES.RESULTS,
      request.strategyAddress.toLowerCase(),
      serializeMessage(resultMessage),
      {
        persistent: true,
        contentType: 'application/json',
        correlationId: request.correlationId,
      }
    );
  }
}
