/**
 * Create Automation Wallet on User Registered Rule
 *
 * When a user.registered domain event is received, this rule creates an
 * automation wallet for the new user via the signer service.
 *
 * The automation wallet is used for signing automated transactions
 * (e.g., position close orders, rebalancing).
 *
 * Events handled:
 * - user.registered: New user created via SIWE authentication
 *
 * Behavior:
 * - Calls POST /api/wallets/automation on the signer service
 * - If wallet already exists (409), acks the message (idempotent)
 * - If signer is unreachable or returns an error, nacks to dead-letter queue
 */

import type { ConsumeMessage } from 'amqplib';
import {
  setupConsumerQueue,
  DOMAIN_EVENTS_EXCHANGE,
  ROUTING_PATTERNS,
  SignerClient,
  type DomainEvent,
  type UserRegisteredPayload,
} from '@midcurve/services';
import { BusinessRule } from './base';

// =============================================================================
// Constants
// =============================================================================

/** Queue name for this rule's consumption */
const QUEUE_NAME = 'business-logic.create-automation-wallet-on-user-registered';

/** Routing pattern to subscribe to user registered events */
const ROUTING_PATTERN = ROUTING_PATTERNS.USER_REGISTERED;

// =============================================================================
// Rule Implementation
// =============================================================================

export class CreateAutomationWalletOnUserRegisteredRule extends BusinessRule {
  readonly ruleName = 'create-automation-wallet-on-user-registered';
  readonly ruleDescription =
    'Creates an automation wallet when a new user registers';

  private consumerTag: string | null = null;

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
      { noAck: false }
    );

    this.consumerTag = result.consumerTag;
    this.logger.info(
      {
        queueName: QUEUE_NAME,
        exchange: DOMAIN_EVENTS_EXCHANGE,
        routingPattern: ROUTING_PATTERN,
      },
      'Subscribed to user.registered events'
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
        msg.content.toString()
      ) as DomainEvent<UserRegisteredPayload>;

      this.logger.info(
        { eventId: event.id, userId: event.entityId },
        'Processing user.registered event'
      );

      await this.processEvent(event);
      this.channel.ack(msg);

      this.logger.info(
        { eventId: event.id, userId: event.entityId },
        'user.registered event processed successfully'
      );
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing user.registered event'
      );
      // Dead-letter the message (don't requeue)
      this.channel.nack(msg, false, false);
    }
  }

  private async processEvent(
    event: DomainEvent<UserRegisteredPayload>
  ): Promise<void> {
    const { userId } = event.payload;

    const signerClient = SignerClient.getInstance();
    const wallet = await signerClient.createAutomationWallet({ userId });

    if (wallet) {
      this.logger.info(
        {
          userId,
          walletAddress: wallet.walletAddress,
        },
        'Automation wallet created for new user'
      );
    }
  }
}
