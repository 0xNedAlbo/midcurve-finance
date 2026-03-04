/**
 * Position Event Handler
 *
 * Single event consumer that handles position.created, position.closed, position.burned,
 * and position.deleted domain events to dynamically update WebSocket subscriptions.
 *
 * Notifies:
 * - PoolPriceSubscriber: for pool price subscriptions (Swap events)
 */

import type { Channel } from 'amqplib';
import type { PositionJSON } from '@midcurve/shared';
import {
  DomainEventConsumer,
  ROUTING_PATTERNS,
  DOMAIN_EVENTS_EXCHANGE,
  parsePositionRoutingKey,
  type DomainEvent,
} from '@midcurve/services';
import type { PoolPriceSubscriber } from '../workers/pool-price-subscriber';

/**
 * Handles position.created, position.closed, position.burned, and position.deleted events
 * for WebSocket subscription management.
 *
 * Uses a single queue bound to all event patterns, dispatching based on event type.
 * Notifies the pool price subscriber.
 */
export class PositionEventHandler extends DomainEventConsumer<PositionJSON> {
  readonly eventPattern = ROUTING_PATTERNS.POSITION_CREATED; // Primary binding
  readonly queueName = 'onchain-data.position-events';

  private poolPriceSubscriber: PoolPriceSubscriber | null = null;

  /**
   * Set the pool price subscriber instance.
   * Must be called before starting the consumer.
   */
  setPoolPriceSubscriber(subscriber: PoolPriceSubscriber): void {
    this.poolPriceSubscriber = subscriber;
  }

  /**
   * Override start() to add second binding for position.closed events.
   */
  override async start(channel?: Channel, prefetch?: number): Promise<void> {
    await super.start(channel, prefetch);

    // Add additional bindings for position.closed, position.burned, and position.deleted events
    if (this.channel) {
      await this.channel.bindQueue(
        this.queueName,
        DOMAIN_EVENTS_EXCHANGE,
        ROUTING_PATTERNS.POSITION_CLOSED
      );
      this.logger.info(
        { pattern: ROUTING_PATTERNS.POSITION_CLOSED },
        'Added additional binding for position.closed events'
      );

      await this.channel.bindQueue(
        this.queueName,
        DOMAIN_EVENTS_EXCHANGE,
        ROUTING_PATTERNS.POSITION_BURNED
      );
      this.logger.info(
        { pattern: ROUTING_PATTERNS.POSITION_BURNED },
        'Added additional binding for position.burned events'
      );

      await this.channel.bindQueue(
        this.queueName,
        DOMAIN_EVENTS_EXCHANGE,
        ROUTING_PATTERNS.POSITION_DELETED
      );
      this.logger.info(
        { pattern: ROUTING_PATTERNS.POSITION_DELETED },
        'Added additional binding for position.deleted events'
      );
    }
  }

  async handle(event: DomainEvent<PositionJSON>, routingKey: string): Promise<void> {
    if (!this.poolPriceSubscriber) {
      this.logger.warn({ eventId: event.id }, 'No subscribers set, skipping event');
      return;
    }

    this.logger.info(
      { eventId: event.id, positionId: event.entityId, eventType: event.type, routingKey },
      'Handling position event'
    );

    if (event.type === 'position.created') {
      await this.poolPriceSubscriber.handlePositionCreated(event.payload);
    } else if (event.type === 'position.closed') {
      // Don't unsubscribe — position may be reopened (IncreaseLiquidity on same NFT).
      // Subscriptions are cleaned up on position.deleted or by the inactive cleanup timer.
      this.logger.info(
        { positionId: event.entityId, routingKey },
        'Position closed, keeping subscriptions active (may be reopened)'
      );
    } else if (event.type === 'position.burned' || event.type === 'position.deleted') {
      // For burned/deleted events, extract coordinates from routing key and unsubscribe
      const coords = parsePositionRoutingKey(routingKey);
      if (!coords) {
        this.logger.error({ routingKey }, `Invalid routing key for ${event.type} event`);
        return;
      }
      await this.poolPriceSubscriber.handlePositionDeleted(coords.chainId, coords.nftId);
    } else {
      this.logger.warn({ eventType: event.type }, 'Unknown position event type');
    }
  }
}
