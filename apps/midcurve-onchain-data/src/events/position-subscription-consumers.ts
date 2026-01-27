/**
 * Position Subscription Event Consumers
 *
 * Event consumers that handle position.created and position.closed domain events
 * to dynamically update WebSocket subscriptions in the PositionLiquiditySubscriber.
 */

import {
  DomainEventConsumer,
  ROUTING_PATTERNS,
  type DomainEvent,
  type PositionCreatedPayload,
  type PositionClosedPayload,
} from '@midcurve/services';
import type { PositionLiquiditySubscriber } from '../workers/position-liquidity-subscriber';

const QUEUE_PREFIX = 'domain.onchain-data';

/**
 * Handles position.created events to add new positions to WebSocket subscriptions.
 */
export class PositionCreatedSubscriptionHandler extends DomainEventConsumer<PositionCreatedPayload> {
  readonly eventPattern = ROUTING_PATTERNS.POSITION_CREATED;
  readonly queueName = `${QUEUE_PREFIX}.position-created.liquidity-subscriber`;

  private subscriber: PositionLiquiditySubscriber | null = null;

  /**
   * Set the subscriber instance to delegate events to.
   * Must be called before starting the consumer.
   */
  setSubscriber(subscriber: PositionLiquiditySubscriber): void {
    this.subscriber = subscriber;
  }

  async handle(event: DomainEvent<PositionCreatedPayload>): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn({ eventId: event.id }, 'No subscriber set, skipping event');
      return;
    }

    this.logger.info(
      { eventId: event.id, positionId: event.entityId, eventType: event.type },
      'Handling position.created event'
    );

    await this.subscriber.handlePositionCreated(event.payload);
  }
}

/**
 * Handles position.closed events to remove positions from WebSocket subscriptions.
 */
export class PositionClosedSubscriptionHandler extends DomainEventConsumer<PositionClosedPayload> {
  readonly eventPattern = ROUTING_PATTERNS.POSITION_CLOSED;
  readonly queueName = `${QUEUE_PREFIX}.position-closed.liquidity-subscriber`;

  private subscriber: PositionLiquiditySubscriber | null = null;

  /**
   * Set the subscriber instance to delegate events to.
   * Must be called before starting the consumer.
   */
  setSubscriber(subscriber: PositionLiquiditySubscriber): void {
    this.subscriber = subscriber;
  }

  async handle(event: DomainEvent<PositionClosedPayload>): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn({ eventId: event.id }, 'No subscriber set, skipping event');
      return;
    }

    this.logger.info(
      { eventId: event.id, positionId: event.entityId, eventType: event.type },
      'Handling position.closed event'
    );

    await this.subscriber.handlePositionClosed(event.payload);
  }
}
