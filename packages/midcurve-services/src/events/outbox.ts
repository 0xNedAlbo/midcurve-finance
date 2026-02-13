/**
 * Domain Event Outbox Publisher
 *
 * Background worker that polls the DomainEventOutbox table for pending events
 * and publishes them to RabbitMQ. After successful publishing, events are
 * copied to the permanent DomainEvent table for audit trail.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import type { Channel } from 'amqplib';
import { createServiceLogger, log } from '../logging/index.js';
import type { ServiceLogger } from '../logging/index.js';
import type { DomainEvent, DomainEventMetadata } from './types.js';
import {
  DOMAIN_EVENTS_EXCHANGE,
  buildPositionRoutingKey,
  buildOrderRoutingKey,
  buildUserRoutingKey,
  getEventSuffix,
} from './topology.js';

// ============================================================
// Configuration
// ============================================================

/**
 * Default configuration for the outbox publisher
 */
export const OUTBOX_CONFIG = {
  /** Polling interval in milliseconds */
  POLL_INTERVAL_MS: 1000,
  /** Maximum events to process per batch */
  BATCH_SIZE: 100,
  /** Maximum retry attempts before marking as failed */
  MAX_RETRIES: 5,
  /** Base delay for exponential backoff (milliseconds) */
  RETRY_DELAY_BASE_MS: 1000,
  /** Cleanup interval in milliseconds (default: 1 hour) */
  CLEANUP_INTERVAL_MS: 60 * 60 * 1000,
  /** Retention period in days for published events (default: 7 days) */
  CLEANUP_RETENTION_DAYS: 7,
} as const;

// ============================================================
// Outbox Publisher Class
// ============================================================

/**
 * Dependencies for OutboxPublisher
 */
export interface OutboxPublisherDependencies {
  prisma?: PrismaClient;
  channel: Channel;
  config?: Partial<typeof OUTBOX_CONFIG>;
}

/**
 * Outbox Publisher Worker
 *
 * Polls the DomainEventOutbox table for pending events and publishes them
 * to RabbitMQ. Handles retries with exponential backoff.
 *
 * Flow:
 * 1. Poll for pending events (status = 'pending', ordered by createdAt)
 * 2. For each event:
 *    a. Publish to RabbitMQ
 *    b. Copy to DomainEvent table (permanent store)
 *    c. Update outbox status to 'published'
 * 3. On failure:
 *    a. Increment retryCount
 *    b. If retryCount >= MAX_RETRIES, mark as 'failed'
 */
export class OutboxPublisher {
  private readonly prisma: PrismaClient;
  private readonly channel: Channel;
  private readonly config: typeof OUTBOX_CONFIG;
  private readonly logger: ServiceLogger;
  private running: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(deps: OutboxPublisherDependencies) {
    this.prisma = deps.prisma ?? prismaClient;
    this.channel = deps.channel;
    this.config = { ...OUTBOX_CONFIG, ...deps.config };
    this.logger = createServiceLogger('OutboxPublisher');
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Start the outbox publisher worker
   */
  start(): void {
    if (this.running) {
      this.logger.warn({}, 'OutboxPublisher already running');
      return;
    }

    this.running = true;
    this.logger.info({ config: this.config }, 'Starting OutboxPublisher');
    this.scheduleNextPoll();
    this.scheduleCleanup();
  }

  /**
   * Stop the outbox publisher worker
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.logger.info({}, 'Stopped OutboxPublisher');
  }

  /**
   * Check if the worker is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // ============================================================================
  // POLLING
  // ============================================================================

  private scheduleNextPoll(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(async () => {
      try {
        await this.processPendingEvents();
      } catch (error) {
        this.logger.error({ error }, 'Error processing pending events');
      }
      this.scheduleNextPoll();
    }, this.config.POLL_INTERVAL_MS);
  }

  /**
   * Schedule periodic cleanup of old published events
   */
  private scheduleCleanup(): void {
    if (!this.running) return;

    this.cleanupTimer = setTimeout(async () => {
      try {
        await this.cleanupPublishedEvents(this.config.CLEANUP_RETENTION_DAYS);
      } catch (error) {
        this.logger.error({ error }, 'Error during outbox cleanup');
      }
      this.scheduleCleanup();
    }, this.config.CLEANUP_INTERVAL_MS);
  }

  /**
   * Process a batch of pending events
   */
  async processPendingEvents(): Promise<number> {
    log.methodEntry(this.logger, 'processPendingEvents', {
      batchSize: this.config.BATCH_SIZE,
    });

    // Fetch pending events
    const pendingEvents = await this.prisma.domainEventOutbox.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: this.config.BATCH_SIZE,
    });

    if (pendingEvents.length === 0) {
      return 0;
    }

    this.logger.debug({ count: pendingEvents.length }, 'Processing pending events');

    let successCount = 0;
    for (const outboxRecord of pendingEvents) {
      try {
        await this.publishAndPersistEvent(outboxRecord);
        successCount++;
      } catch (error) {
        await this.handlePublishError(outboxRecord, error);
      }
    }

    log.methodExit(this.logger, 'processPendingEvents', {
      processed: pendingEvents.length,
      succeeded: successCount,
      failed: pendingEvents.length - successCount,
    });

    return successCount;
  }

  // ============================================================================
  // EVENT PUBLISHING
  // ============================================================================

  /**
   * Publish an event to RabbitMQ and persist to permanent store
   */
  private async publishAndPersistEvent(
    outboxRecord: {
      id: string;
      eventType: string;
      entityType: string;
      entityId: string;
      payload: Prisma.JsonValue;
      metadata: Prisma.JsonValue;
    }
  ): Promise<void> {
    const metadata = outboxRecord.metadata as unknown as DomainEventMetadata;

    // Reconstruct the domain event
    const event: DomainEvent = {
      id: outboxRecord.id,
      type: outboxRecord.eventType as DomainEvent['type'],
      entityId: outboxRecord.entityId,
      entityType: outboxRecord.entityType as DomainEvent['entityType'],
      timestamp: new Date().toISOString(),
      version: 1,
      payload: outboxRecord.payload,
      metadata,
    };

    // Build routing key based on entity type
    let routingKey: string;
    if (outboxRecord.entityType === 'position') {
      // Position events: use positionHash from payload
      const payload = outboxRecord.payload as { positionHash?: string };
      if (!payload.positionHash) {
        throw new Error(
          `Position event payload missing positionHash: ${outboxRecord.eventType} (id: ${outboxRecord.id})`
        );
      }
      routingKey = buildPositionRoutingKey(outboxRecord.eventType, payload.positionHash);
    } else if (outboxRecord.entityType === 'user') {
      // User events: use userId from entityId
      routingKey = buildUserRoutingKey(outboxRecord.eventType, outboxRecord.entityId);
    } else {
      // Order events: use legacy format
      const eventSuffix = getEventSuffix(outboxRecord.eventType);
      routingKey = buildOrderRoutingKey(outboxRecord.entityId, eventSuffix);
    }

    // Publish to RabbitMQ
    const message = Buffer.from(JSON.stringify(event));
    this.channel.publish(DOMAIN_EVENTS_EXCHANGE, routingKey, message, {
      persistent: true,
      contentType: 'application/json',
      headers: {
        eventType: outboxRecord.eventType,
        entityType: outboxRecord.entityType,
        entityId: outboxRecord.entityId,
        source: metadata.source,
      },
    });

    // Persist to permanent store and update outbox atomically
    await this.prisma.$transaction(async (tx) => {
      // Copy to permanent DomainEvent table
      await tx.domainEvent.create({
        data: {
          id: outboxRecord.id,
          eventType: outboxRecord.eventType,
          entityType: outboxRecord.entityType,
          entityId: outboxRecord.entityId,
          payload: outboxRecord.payload as Prisma.InputJsonValue,
          metadata: outboxRecord.metadata as Prisma.InputJsonValue,
          version: 1,
        },
      });

      // Update outbox status to published
      await tx.domainEventOutbox.update({
        where: { id: outboxRecord.id },
        data: {
          status: 'published',
          publishedAt: new Date(),
        },
      });
    });

    this.logger.debug(
      { eventId: outboxRecord.id, eventType: outboxRecord.eventType, routingKey },
      'Event published and persisted'
    );
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  /**
   * Handle a publish error with retry logic
   */
  private async handlePublishError(
    outboxRecord: { id: string; retryCount: number; eventType: string },
    error: unknown
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const newRetryCount = outboxRecord.retryCount + 1;

    if (newRetryCount >= this.config.MAX_RETRIES) {
      // Max retries exceeded - mark as failed
      await this.prisma.domainEventOutbox.update({
        where: { id: outboxRecord.id },
        data: {
          status: 'failed',
          retryCount: newRetryCount,
          lastError: errorMessage,
        },
      });

      this.logger.error(
        {
          eventId: outboxRecord.id,
          eventType: outboxRecord.eventType,
          retryCount: newRetryCount,
          error: errorMessage,
        },
        'Event failed after max retries'
      );
    } else {
      // Update retry count and error
      await this.prisma.domainEventOutbox.update({
        where: { id: outboxRecord.id },
        data: {
          retryCount: newRetryCount,
          lastError: errorMessage,
        },
      });

      this.logger.warn(
        {
          eventId: outboxRecord.id,
          eventType: outboxRecord.eventType,
          retryCount: newRetryCount,
          error: errorMessage,
        },
        'Event publish failed, will retry'
      );
    }
  }

  // ============================================================================
  // MANUAL OPERATIONS
  // ============================================================================

  /**
   * Process a single event by ID (useful for manual retries)
   */
  async processEventById(eventId: string): Promise<boolean> {
    log.methodEntry(this.logger, 'processEventById', { eventId });

    const outboxRecord = await this.prisma.domainEventOutbox.findUnique({
      where: { id: eventId },
    });

    if (!outboxRecord) {
      this.logger.warn({ eventId }, 'Event not found in outbox');
      return false;
    }

    if (outboxRecord.status === 'published') {
      this.logger.info({ eventId }, 'Event already published');
      return true;
    }

    try {
      await this.publishAndPersistEvent(outboxRecord);
      return true;
    } catch (error) {
      await this.handlePublishError(outboxRecord, error);
      return false;
    }
  }

  /**
   * Get outbox statistics
   */
  async getStats(): Promise<{
    pending: number;
    published: number;
    failed: number;
    total: number;
  }> {
    const [pending, published, failed] = await Promise.all([
      this.prisma.domainEventOutbox.count({ where: { status: 'pending' } }),
      this.prisma.domainEventOutbox.count({ where: { status: 'published' } }),
      this.prisma.domainEventOutbox.count({ where: { status: 'failed' } }),
    ]);

    return {
      pending,
      published,
      failed,
      total: pending + published + failed,
    };
  }

  /**
   * Cleanup old published events from outbox (retain for N days)
   *
   * @param retentionDays - Number of days to retain published events
   * @returns Number of deleted records
   */
  async cleanupPublishedEvents(retentionDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.prisma.domainEventOutbox.deleteMany({
      where: {
        status: 'published',
        publishedAt: { lt: cutoffDate },
      },
    });

    this.logger.info(
      { deletedCount: result.count, retentionDays },
      'Cleaned up old published events from outbox'
    );

    return result.count;
  }
}
