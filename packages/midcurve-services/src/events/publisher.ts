/**
 * Domain Event Publisher
 *
 * Provides two publishing modes:
 * 1. Transactional (via outbox) - Guarantees at-least-once delivery
 * 2. Direct - Best-effort delivery for non-critical events
 */

import { createId } from '@paralleldrive/cuid2';
import { PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import type { Channel } from 'amqplib';
import { createServiceLogger, log } from '../logging/index.js';
import type { ServiceLogger } from '../logging/index.js';
import type {
  DomainEvent,
  DomainEventType,
  DomainEntityType,
  DomainEventSource,
} from './types.js';
import {
  DOMAIN_EVENTS_EXCHANGE,
  buildPositionRoutingKey,
  buildOrderRoutingKey,
  buildUserRoutingKey,
  getEventSuffix,
} from './topology.js';

// ============================================================
// Event Builder Types
// ============================================================

/**
 * Input for creating a new domain event
 */
export interface CreateDomainEventInput<TPayload = unknown> {
  /** Event type (e.g., 'position.closed') */
  type: DomainEventType;
  /** Entity ID (positionId, orderId, etc.) */
  entityId: string;
  /** Entity type for routing */
  entityType: DomainEntityType;
  /** User ID if applicable */
  userId?: string;
  /** Event-specific payload */
  payload: TPayload;
  /** Source service publishing the event */
  source: DomainEventSource;
  /** Trace ID for distributed tracing (optional, generated if not provided) */
  traceId?: string;
  /** Parent event ID if this event was caused by another event */
  causedBy?: string;
}

// ============================================================
// Event Builder
// ============================================================

/**
 * Generate a UUID v4 for tracing
 */
function generateTraceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Build a complete domain event from input
 */
export function createDomainEvent<TPayload>(
  input: CreateDomainEventInput<TPayload>
): DomainEvent<TPayload> {
  return {
    id: createId(),
    type: input.type,
    entityId: input.entityId,
    entityType: input.entityType,
    userId: input.userId,
    timestamp: new Date().toISOString(),
    version: 1,
    payload: input.payload,
    metadata: {
      source: input.source,
      traceId: input.traceId ?? generateTraceId(),
      causedBy: input.causedBy,
    },
  };
}

// ============================================================
// Publisher Class
// ============================================================

/**
 * Dependencies for DomainEventPublisher
 */
export interface DomainEventPublisherDependencies {
  /** Prisma client for outbox operations */
  prisma?: PrismaClient;
  /** RabbitMQ channel for direct publishing (optional) */
  channel?: Channel;
}

/**
 * Domain Event Publisher
 *
 * Supports two publishing modes:
 *
 * 1. **Transactional (Outbox Pattern)**: Use `publish()` to write events to the
 *    DomainEventOutbox table within the same transaction as your state changes.
 *    A background worker then publishes these to RabbitMQ, ensuring at-least-once
 *    delivery even if the service crashes after the transaction commits.
 *
 * 2. **Direct**: Use `publishDirect()` to publish immediately to RabbitMQ.
 *    Use this for non-critical events where eventual consistency is acceptable
 *    and you don't need transactional guarantees.
 */
export class DomainEventPublisher {
  private readonly prisma: PrismaClient;
  private channel: Channel | null;
  private readonly logger: ServiceLogger;

  constructor(deps: DomainEventPublisherDependencies = {}) {
    this.prisma = deps.prisma ?? new PrismaClient();
    this.channel = deps.channel ?? null;
    this.logger = createServiceLogger('DomainEventPublisher');
  }

  /**
   * Set the RabbitMQ channel for direct publishing
   */
  setChannel(channel: Channel): void {
    this.channel = channel;
  }

  // ============================================================================
  // TRANSACTIONAL PUBLISHING (Outbox Pattern)
  // ============================================================================

  /**
   * Publish an event via the transactional outbox pattern.
   *
   * This writes the event to the DomainEventOutbox table, which should be done
   * within the same transaction as your state change. A background worker then
   * publishes pending events to RabbitMQ.
   *
   * **Use this method** when you need guaranteed delivery and atomicity with
   * your database transaction.
   *
   * @param event - The domain event to publish
   * @param prismaClient - Optional Prisma client/transaction to use for the write
   * @returns The event ID
   *
   * @example
   * ```typescript
   * // Within a transaction
   * await prisma.$transaction(async (tx) => {
   *   // Update state
   *   await tx.position.update({ ... });
   *
   *   // Publish event atomically
   *   await publisher.publish(event, tx);
   * });
   * ```
   */
  async publish<TPayload>(
    event: DomainEvent<TPayload>,
    prismaClient?: PrismaClient | Prisma.TransactionClient
  ): Promise<string> {
    const client = prismaClient ?? this.prisma;

    log.methodEntry(this.logger, 'publish', {
      eventId: event.id,
      eventType: event.type,
      entityId: event.entityId,
    });

    try {
      await client.domainEventOutbox.create({
        data: {
          id: event.id,
          eventType: event.type,
          entityType: event.entityType,
          entityId: event.entityId,
          payload: event.payload as unknown as Prisma.InputJsonValue,
          metadata: event.metadata as unknown as Prisma.InputJsonValue,
          status: 'pending',
        },
      });

      log.methodExit(this.logger, 'publish', {
        eventId: event.id,
        status: 'pending',
      });

      return event.id;
    } catch (error) {
      this.logger.error(
        { eventId: event.id, eventType: event.type, error },
        'Failed to write event to outbox'
      );
      throw error;
    }
  }

  /**
   * Convenience method to create and publish an event in one call.
   *
   * @param input - Event creation input
   * @param prismaClient - Optional Prisma client/transaction
   * @returns The created and queued event
   */
  async createAndPublish<TPayload>(
    input: CreateDomainEventInput<TPayload>,
    prismaClient?: PrismaClient | Prisma.TransactionClient
  ): Promise<DomainEvent<TPayload>> {
    const event = createDomainEvent(input);
    await this.publish(event, prismaClient);
    return event;
  }

  // ============================================================================
  // DIRECT PUBLISHING
  // ============================================================================

  /**
   * Publish an event directly to RabbitMQ without using the outbox.
   *
   * **Use this method** for non-critical events where:
   * - Eventual consistency is acceptable
   * - You don't need transactional guarantees
   * - You want lower latency
   *
   * **Note**: If the publish fails, the event is lost. Consider using `publish()`
   * for critical events that must not be lost.
   *
   * @param event - The domain event to publish
   * @throws Error if no channel is configured
   */
  async publishDirect<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    if (!this.channel) {
      throw new Error('No RabbitMQ channel configured for direct publishing');
    }

    log.methodEntry(this.logger, 'publishDirect', {
      eventId: event.id,
      eventType: event.type,
      entityId: event.entityId,
    });

    // Build routing key based on entity type
    let routingKey: string;
    if (event.entityType === 'position') {
      // Position events: use positionHash from payload
      const payload = event.payload as { positionHash?: string };
      if (!payload.positionHash) {
        throw new Error(
          `Position event payload missing positionHash: ${event.type} (id: ${event.id})`
        );
      }
      routingKey = buildPositionRoutingKey(event.type, payload.positionHash);
    } else if (event.entityType === 'user') {
      // User events: use userId from entityId
      routingKey = buildUserRoutingKey(event.type, event.entityId);
    } else {
      // Order events: use legacy format
      const eventSuffix = getEventSuffix(event.type);
      routingKey = buildOrderRoutingKey(event.entityId, eventSuffix);
    }

    try {
      const message = Buffer.from(JSON.stringify(event));

      this.channel.publish(DOMAIN_EVENTS_EXCHANGE, routingKey, message, {
        persistent: true,
        contentType: 'application/json',
        headers: {
          eventType: event.type,
          entityType: event.entityType,
          entityId: event.entityId,
          source: event.metadata.source,
        },
      });

      log.methodExit(this.logger, 'publishDirect', {
        eventId: event.id,
        routingKey,
      });
    } catch (error) {
      this.logger.error(
        { eventId: event.id, eventType: event.type, error },
        'Failed to publish event directly'
      );
      throw error;
    }
  }

  /**
   * Convenience method to create and publish an event directly in one call.
   */
  async createAndPublishDirect<TPayload>(
    input: CreateDomainEventInput<TPayload>
  ): Promise<DomainEvent<TPayload>> {
    const event = createDomainEvent(input);
    await this.publishDirect(event);
    return event;
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let publisherInstance: DomainEventPublisher | null = null;

/**
 * Get the singleton DomainEventPublisher instance.
 *
 * @param deps - Optional dependencies for initialization
 */
export function getDomainEventPublisher(
  deps?: DomainEventPublisherDependencies
): DomainEventPublisher {
  if (!publisherInstance) {
    publisherInstance = new DomainEventPublisher(deps);
  }
  return publisherInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetDomainEventPublisher(): void {
  publisherInstance = null;
}
