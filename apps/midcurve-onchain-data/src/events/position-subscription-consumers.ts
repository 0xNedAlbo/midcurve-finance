/**
 * Position Event Handler
 *
 * Single event consumer that handles position.created, position.closed, and
 * position.deleted domain events to dynamically update WebSocket subscriptions.
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
import type { PositionLiquiditySubscriber } from '../workers/position-liquidity-subscriber';

/**
 * Handles position.created, position.closed, and position.deleted events for WebSocket subscription management.
 *
 * Uses a single queue bound to all event patterns, dispatching based on event type.
 */
export class PositionEventHandler extends DomainEventConsumer<PositionJSON> {
  readonly eventPattern = ROUTING_PATTERNS.POSITION_CREATED; // Primary binding
  readonly queueName = 'onchain-data.position-events';

  private subscriber: PositionLiquiditySubscriber | null = null;

  /**
   * Set the subscriber instance to delegate events to.
   * Must be called before starting the consumer.
   */
  setSubscriber(subscriber: PositionLiquiditySubscriber): void {
    this.subscriber = subscriber;
  }

  /**
   * Override start() to add second binding for position.closed events.
   */
  override async start(channel?: Channel, prefetch?: number): Promise<void> {
    await super.start(channel, prefetch);

    // Add additional bindings for position.closed and position.deleted events
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
        ROUTING_PATTERNS.POSITION_DELETED
      );
      this.logger.info(
        { pattern: ROUTING_PATTERNS.POSITION_DELETED },
        'Added additional binding for position.deleted events'
      );
    }
  }

  async handle(event: DomainEvent<PositionJSON>, routingKey: string): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn({ eventId: event.id }, 'No subscriber set, skipping event');
      return;
    }

    this.logger.info(
      { eventId: event.id, positionId: event.entityId, eventType: event.type, routingKey },
      'Handling position event'
    );

    if (event.type === 'position.created') {
      // For created events, we need the full payload for position data
      await this.subscriber.handlePositionCreated(event.payload);
    } else if (event.type === 'position.closed') {
      // For closed events, extract coordinates from routing key
      const coords = parsePositionRoutingKey(routingKey);
      if (!coords) {
        this.logger.error({ routingKey }, 'Invalid routing key for position.closed event');
        return;
      }
      await this.subscriber.handlePositionClosed(coords.chainId, coords.nftId);
    } else if (event.type === 'position.deleted') {
      // For deleted events, extract coordinates from routing key
      const coords = parsePositionRoutingKey(routingKey);
      if (!coords) {
        this.logger.error({ routingKey }, 'Invalid routing key for position.deleted event');
        return;
      }
      await this.subscriber.handlePositionDeleted(coords.chainId, coords.nftId);
    } else {
      this.logger.warn({ eventType: event.type }, 'Unknown position event type');
    }
  }
}
