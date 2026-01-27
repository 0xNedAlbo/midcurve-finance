/**
 * Domain Event Consumer Base Class
 *
 * Abstract base class for implementing domain event handlers.
 * Provides common functionality for subscribing to events and handling them.
 */

import type { Channel, ConsumeMessage } from 'amqplib';
import { createServiceLogger } from '../logging/index.js';
import type { ServiceLogger } from '../logging/index.js';
import type { DomainEvent } from './types.js';
import { setupConsumerQueue } from './topology.js';

// ============================================================
// Consumer Base Class
// ============================================================

/**
 * Abstract base class for domain event consumers.
 *
 * Subclasses must implement:
 * - `eventPattern`: The routing key pattern to subscribe to (e.g., 'position.*.closed')
 * - `queueName`: The queue name for this consumer
 * - `handle()`: The event handler method
 *
 * @template TPayload - The expected payload type for events this consumer handles
 *
 * @example
 * ```typescript
 * class PositionClosedHandler extends DomainEventConsumer<PositionClosedPayload> {
 *   readonly eventPattern = 'positions.closed.#';
 *   readonly queueName = 'domain.position-closed.my-handler';
 *
 *   async handle(event: DomainEvent<PositionClosedPayload>, routingKey: string): Promise<void> {
 *     // Handle the event
 *     // routingKey format: positions.closed.{protocol}.{chainId}.{nftId}
 *   }
 * }
 * ```
 */
export abstract class DomainEventConsumer<TPayload = unknown> {
  /** Routing key pattern to subscribe to (supports wildcards) */
  abstract readonly eventPattern: string;

  /** Queue name for this consumer */
  abstract readonly queueName: string;

  protected readonly logger: ServiceLogger;
  protected channel: Channel | null = null;
  private consumerTag: string | null = null;
  private running: boolean = false;

  constructor() {
    this.logger = createServiceLogger(this.constructor.name);
  }

  // ============================================================================
  // ABSTRACT METHOD - Must be implemented by subclasses
  // ============================================================================

  /**
   * Handle a domain event.
   * Implement this method in subclasses to process events.
   *
   * **Important**: This method should be idempotent. Events may be delivered
   * more than once (at-least-once delivery).
   *
   * @param event - The domain event to handle
   * @param routingKey - The routing key used to deliver this message
   * @throws Error if the event cannot be processed (will be retried or dead-lettered)
   */
  abstract handle(event: DomainEvent<TPayload>, routingKey: string): Promise<void>;

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Set the RabbitMQ channel
   */
  setChannel(channel: Channel): void {
    this.channel = channel;
  }

  /**
   * Start consuming events.
   *
   * This will:
   * 1. Setup the queue and bindings (if not exists)
   * 2. Start consuming messages from the queue
   *
   * @param channel - Optional RabbitMQ channel (uses stored channel if not provided)
   * @param prefetch - Number of messages to prefetch (default: 1 for fair dispatch)
   */
  async start(channel?: Channel, prefetch: number = 1): Promise<void> {
    if (this.running) {
      this.logger.warn({}, 'Consumer already running');
      return;
    }

    const ch = channel ?? this.channel;
    if (!ch) {
      throw new Error('No RabbitMQ channel available');
    }

    this.channel = ch;
    this.logger.info(
      { eventPattern: this.eventPattern, queueName: this.queueName },
      'Starting consumer'
    );

    // Setup queue and bindings
    await setupConsumerQueue(ch, this.queueName, this.eventPattern);

    // Set prefetch for fair dispatch
    await ch.prefetch(prefetch);

    // Start consuming
    const result = await ch.consume(
      this.queueName,
      (msg) => this.onMessage(msg),
      { noAck: false } // Manual acknowledgment
    );

    this.consumerTag = result.consumerTag;
    this.running = true;

    this.logger.info(
      { consumerTag: this.consumerTag, queueName: this.queueName },
      'Consumer started'
    );
  }

  /**
   * Stop consuming events.
   */
  async stop(): Promise<void> {
    if (!this.running || !this.channel || !this.consumerTag) {
      return;
    }

    this.logger.info({ consumerTag: this.consumerTag }, 'Stopping consumer');

    try {
      await this.channel.cancel(this.consumerTag);
    } catch (error) {
      this.logger.warn({ error }, 'Error cancelling consumer');
    }

    this.running = false;
    this.consumerTag = null;
  }

  /**
   * Check if the consumer is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  /**
   * Process a message from the queue
   */
  private async onMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) {
      return;
    }

    const startTime = Date.now();
    const routingKey = msg.fields.routingKey;
    let event: DomainEvent<TPayload> | null = null;

    try {
      // Parse the message
      event = this.parseMessage(msg);

      this.logger.debug(
        { eventId: event.id, eventType: event.type, entityId: event.entityId, routingKey },
        'Processing event'
      );

      // Handle the event
      await this.handle(event, routingKey);

      // Acknowledge success
      this.channel.ack(msg);

      const duration = Date.now() - startTime;
      this.logger.debug(
        { eventId: event.id, eventType: event.type, durationMs: duration },
        'Event processed successfully'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          eventId: event?.id,
          eventType: event?.type,
          routingKey,
          error: errorMessage,
        },
        'Error processing event'
      );

      // Reject and requeue (will be dead-lettered after max retries by RabbitMQ)
      // Using requeue=false sends to dead letter queue immediately
      this.channel.nack(msg, false, false);
    }
  }

  /**
   * Parse a RabbitMQ message into a DomainEvent
   */
  private parseMessage(msg: ConsumeMessage): DomainEvent<TPayload> {
    try {
      const content = msg.content.toString();
      const event = JSON.parse(content) as DomainEvent<TPayload>;

      // Basic validation
      if (!event.id || !event.type || !event.entityId) {
        throw new Error('Invalid event: missing required fields');
      }

      return event;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse message: ${errorMessage}`);
    }
  }

  // ============================================================================
  // UTILITY METHODS FOR SUBCLASSES
  // ============================================================================

  /**
   * Check if we've already processed this event (for idempotency).
   * Subclasses can override this to implement their own idempotency check.
   *
   * @param eventId - The event ID to check
   * @returns true if already processed
   */
  protected async hasProcessedEvent(_eventId: string): Promise<boolean> {
    // Default implementation: always returns false (no idempotency tracking)
    // Subclasses should override this if they need idempotency guarantees
    return false;
  }

  /**
   * Mark an event as processed (for idempotency).
   * Subclasses can override this to implement their own idempotency tracking.
   *
   * @param eventId - The event ID to mark as processed
   */
  protected async markEventProcessed(_eventId: string): Promise<void> {
    // Default implementation: no-op
    // Subclasses should override this if they need idempotency guarantees
  }
}

// ============================================================
// Consumer Registry
// ============================================================

/**
 * Registry for managing multiple consumers
 */
export class DomainEventConsumerRegistry {
  private readonly consumers: Map<string, DomainEventConsumer> = new Map();
  private readonly logger: ServiceLogger;

  constructor() {
    this.logger = createServiceLogger('DomainEventConsumerRegistry');
  }

  /**
   * Register a consumer
   */
  register(consumer: DomainEventConsumer): void {
    if (this.consumers.has(consumer.queueName)) {
      throw new Error(`Consumer already registered for queue: ${consumer.queueName}`);
    }
    this.consumers.set(consumer.queueName, consumer);
    this.logger.info(
      { queueName: consumer.queueName, eventPattern: consumer.eventPattern },
      'Consumer registered'
    );
  }

  /**
   * Start all registered consumers
   */
  async startAll(channel: Channel): Promise<void> {
    this.logger.info({ count: this.consumers.size }, 'Starting all consumers');

    for (const consumer of this.consumers.values()) {
      await consumer.start(channel);
    }
  }

  /**
   * Stop all registered consumers
   */
  async stopAll(): Promise<void> {
    this.logger.info({ count: this.consumers.size }, 'Stopping all consumers');

    for (const consumer of this.consumers.values()) {
      await consumer.stop();
    }
  }

  /**
   * Get a consumer by queue name
   */
  get(queueName: string): DomainEventConsumer | undefined {
    return this.consumers.get(queueName);
  }

  /**
   * Get all registered consumers
   */
  getAll(): DomainEventConsumer[] {
    return Array.from(this.consumers.values());
  }
}
