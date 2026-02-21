/**
 * Discover Positions on User Registered Rule
 *
 * When a user.registered domain event is received, this rule delegates to
 * UniswapV3PositionService.discoverWalletPositions() to enumerate and import
 * all active positions across all supported chains, then publishes
 * position.created domain events for each newly discovered position.
 *
 * Events handled:
 * - user.registered: New user created via SIWE authentication
 */

import type { ConsumeMessage } from 'amqplib';
import {
  setupConsumerQueue,
  ROUTING_PATTERNS,
  UniswapV3PositionService,
  getDomainEventPublisher,
  type DomainEvent,
  type UserRegisteredPayload,
  type PositionCreatedPayload,
} from '@midcurve/services';
import type { Address } from 'viem';
import { BusinessRule } from '../base';

// =============================================================================
// Constants
// =============================================================================

/** Queue name for this rule's consumption */
const QUEUE_NAME = 'business-logic.discover-positions-on-user-registered';

/** Routing pattern to subscribe to user registered events */
const ROUTING_PATTERN = ROUTING_PATTERNS.USER_REGISTERED;

// =============================================================================
// Rule Implementation
// =============================================================================

export class DiscoverPositionsOnUserRegisteredRule extends BusinessRule {
  readonly ruleName = 'discover-positions-on-user-registered';
  readonly ruleDescription =
    'Discovers and imports all open UniswapV3 positions when a new user registers';

  private consumerTag: string | null = null;
  private readonly positionService: UniswapV3PositionService;

  constructor() {
    super();
    this.positionService = new UniswapV3PositionService();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    if (!this.channel) throw new Error('No channel available');

    // Setup queue bound to the domain events exchange
    await setupConsumerQueue(this.channel, QUEUE_NAME, ROUTING_PATTERN);

    // Set prefetch to 1 for sequential processing
    await this.channel.prefetch(1);

    // Start consuming
    const result = await this.channel.consume(
      QUEUE_NAME,
      (msg) => this.handleMessage(msg),
      { noAck: false },
    );

    this.consumerTag = result.consumerTag;
    this.logger.info(
      { queueName: QUEUE_NAME, routingPattern: ROUTING_PATTERN },
      'Subscribed to user.registered events for position discovery',
    );
  }

  protected async onShutdown(): Promise<void> {
    if (this.consumerTag && this.channel) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    try {
      const event = JSON.parse(
        msg.content.toString(),
      ) as DomainEvent<UserRegisteredPayload>;

      this.logger.info(
        { eventId: event.id, userId: event.entityId },
        'Processing user.registered event for position discovery',
      );

      await this.processEvent(event);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing user.registered event for position discovery',
      );
      // Dead-letter the message (don't requeue)
      this.channel.nack(msg, false, false);
    }
  }

  // ===========================================================================
  // Core Logic
  // ===========================================================================

  private async processEvent(
    event: DomainEvent<UserRegisteredPayload>,
  ): Promise<void> {
    const { userId, walletAddress } = event.payload;

    const result = await this.positionService.discoverWalletPositions(
      userId,
      walletAddress as Address,
    );

    // Publish position.created events with causal link to the triggering event
    const eventPublisher = getDomainEventPublisher();
    for (const position of result.positions) {
      await eventPublisher.createAndPublish<PositionCreatedPayload>({
        type: 'position.created',
        entityType: 'position',
        entityId: position.id,
        userId: position.userId,
        payload: position.toJSON(),
        source: 'business-logic',
        causedBy: event.id,
      });
    }

    this.logger.info(
      {
        userId,
        walletAddress,
        found: result.found,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
      },
      'Position discovery completed',
    );
  }
}
