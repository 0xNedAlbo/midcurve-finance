/**
 * UniswapV3ReevaluateOnWalletChangeRule
 *
 * Subscribes to wallet.added and wallet.removed domain events.
 * When a user's wallet set changes, re-evaluates every UniswapV3 NFT
 * position of that user: ownership is tracked per ledger event via
 * isIgnored flags that depend on the full wallet set, so the aggregates
 * have to be recomputed against the new set.
 *
 * `recalculateAggregates` persists isIgnored, ignoredReason and every
 * running total (costBasisAfter, pnlAfter, collectedYieldAfter, …) back
 * onto the ledger rows, and rebuilds the APR periods.
 *
 * ## Why there is no vault branch
 *
 * Vault positions are tied to a single ownerAddress and have no per-event
 * isIgnored — `UniswapV3VaultLedgerService.recalculateAggregates` takes no
 * wallet set at all. A wallet change cannot move a vault aggregate, so
 * there is nothing for this rule to do for them.
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
  setupConsumerQueue,
  ROUTING_PATTERNS,
  UserWalletService,
  UniswapV3LedgerService,
  type DomainEvent,
  type WalletChangedPayload,
} from '@midcurve/services';
import { BusinessRule } from '../../base';

// =============================================================================
// Constants
// =============================================================================

const QUEUE_NAME = 'business-logic.uniswapv3-reevaluate-on-wallet-change';

// =============================================================================
// Rule Implementation
// =============================================================================

export class UniswapV3ReevaluateOnWalletChangeRule extends BusinessRule {
  readonly ruleName = 'uniswapv3-reevaluate-on-wallet-change';
  readonly ruleDescription =
    'Recalculates ledger aggregates and isIgnored flags when a user wallet set changes';

  private consumerTag: string | null = null;
  private readonly userWalletService: UserWalletService;

  constructor() {
    super();
    this.userWalletService = new UserWalletService();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    if (!this.channel) throw new Error('No channel available');

    await setupConsumerQueue(this.channel, QUEUE_NAME, ROUTING_PATTERNS.ALL_WALLET_EVENTS);
    await this.channel.prefetch(1);

    const result = await this.channel.consume(
      QUEUE_NAME,
      (msg) => this.handleMessage(msg),
      { noAck: false },
    );

    this.consumerTag = result.consumerTag;
    this.logger.info(
      { queueName: QUEUE_NAME, routingPattern: ROUTING_PATTERNS.ALL_WALLET_EVENTS },
      'Subscribed to wallet change events',
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
      const event = JSON.parse(msg.content.toString()) as DomainEvent<WalletChangedPayload>;

      this.logger.info(
        { eventId: event.id, eventType: event.type, userId: event.payload.userId },
        'Processing wallet change event',
      );

      await this.handleWalletChanged(event);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing wallet change event',
      );
      this.channel.nack(msg, false, false);
    }
  }

  // ===========================================================================
  // Core Logic
  // ===========================================================================

  private async handleWalletChanged(
    event: DomainEvent<WalletChangedPayload>,
  ): Promise<void> {
    const { userId } = event.payload;

    // 1. Build updated wallet address set
    const walletAddresses = await this.buildUserWalletAddresses(userId);
    this.logger.info(
      { userId, walletCount: walletAddresses.size, eventType: event.type },
      'Built updated wallet address set',
    );

    // 2. Re-evaluate UniswapV3 NFT positions (all of them — ownership is per-event)
    await this.reevaluateNftPositions(userId, walletAddresses);
  }

  // ===========================================================================
  // NFT Positions — recalculate isIgnored + running totals
  // ===========================================================================

  private async reevaluateNftPositions(
    userId: string,
    walletAddresses: Set<string>,
  ): Promise<void> {
    const positions = await prisma.position.findMany({
      where: { userId, protocol: 'uniswapv3' },
      select: { id: true, positionHash: true, config: true },
    });

    if (positions.length === 0) {
      this.logger.info({ userId }, 'No UniswapV3 NFT positions to re-evaluate');
      return;
    }

    this.logger.info(
      { userId, positionCount: positions.length },
      'Re-evaluating NFT positions after wallet change',
    );

    for (const position of positions) {
      await this.reevaluateNftPosition(position, walletAddresses);
    }

    this.logger.info(
      { userId, positionCount: positions.length },
      'Completed re-evaluation of NFT positions',
    );
  }

  private async reevaluateNftPosition(
    position: { id: string; positionHash: string | null; config: unknown },
    walletAddresses: Set<string>,
  ): Promise<void> {
    const positionId = position.id;
    const config = position.config as Record<string, unknown>;
    const isToken0Quote = config.isToken0Quote as boolean;
    const tickLower = config.tickLower as number;
    const tickUpper = config.tickUpper as number;

    this.logger.info(
      { positionId, positionHash: position.positionHash },
      'Re-evaluating NFT position',
    );

    const ledgerService = new UniswapV3LedgerService({ positionId });
    await ledgerService.recalculateAggregates(
      isToken0Quote,
      walletAddresses,
      tickLower,
      tickUpper,
    );
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async buildUserWalletAddresses(userId: string): Promise<Set<string>> {
    const wallets = await this.userWalletService.findByUserId(userId);
    return new Set(
      wallets
        .filter(w => w.walletType === 'evm')
        .map(w => (w.config as { address: string }).address.toLowerCase()),
    );
  }
}
