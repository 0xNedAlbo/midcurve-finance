/**
 * Discover Positions on User Registered Rule
 *
 * When a user.registered domain event is received, this rule enumerates all
 * UniswapV3 positions owned by the user's wallet across all supported chains
 * and imports active positions (liquidity > 0 OR tokensOwed > 0).
 *
 * For each discovered position:
 * 1. Check if position already exists in DB (skip if so)
 * 2. Call discover() to import position from on-chain data
 * 3. Publish position.created domain event
 * Steps 2+3 happen in the same DB transaction per position.
 *
 * Chains are scanned in parallel (Promise.allSettled) — one failing chain
 * does not block the others.
 *
 * Events handled:
 * - user.registered: New user created via SIWE authentication
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
  setupConsumerQueue,
  ROUTING_PATTERNS,
  EvmConfig,
  SupportedChainId,
  UniswapV3PositionService,
  enumerateWalletPositions,
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
  private readonly evmConfig: EvmConfig;

  constructor() {
    super();
    this.positionService = new UniswapV3PositionService();
    this.evmConfig = EvmConfig.getInstance();
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

    // Get all production chain IDs (exclude LOCAL)
    const chainIds = this.evmConfig
      .getSupportedChainIds()
      .filter((id) => id !== SupportedChainId.LOCAL);

    this.logger.info(
      { userId, walletAddress, chainCount: chainIds.length },
      'Starting position discovery across all chains',
    );

    // Scan all chains in parallel
    const results = await Promise.allSettled(
      chainIds.map((chainId) =>
        this.discoverPositionsOnChain(userId, walletAddress as Address, chainId, event),
      ),
    );

    // Aggregate and log results
    let totalFound = 0;
    let totalImported = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const chainId = chainIds[i]!;

      if (result.status === 'fulfilled') {
        totalFound += result.value.found;
        totalImported += result.value.imported;
        totalSkipped += result.value.skipped;
        totalErrors += result.value.errors;
      } else {
        totalErrors++;
        this.logger.error(
          {
            userId,
            chainId,
            error: result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          },
          'Chain-level position discovery failed',
        );
      }
    }

    this.logger.info(
      {
        userId,
        walletAddress,
        chainsScanned: chainIds.length,
        positionsFound: totalFound,
        positionsImported: totalImported,
        positionsSkipped: totalSkipped,
        errors: totalErrors,
      },
      'Position discovery completed',
    );
  }

  /**
   * Discover all positions on a single chain.
   */
  private async discoverPositionsOnChain(
    userId: string,
    walletAddress: Address,
    chainId: number,
    event: DomainEvent<UserRegisteredPayload>,
  ): Promise<{ found: number; imported: number; skipped: number; errors: number }> {
    let client;
    try {
      client = this.evmConfig.getPublicClient(chainId);
    } catch {
      // RPC URL not configured for this chain — skip silently
      this.logger.debug({ chainId }, 'Skipping chain: no RPC configured');
      return { found: 0, imported: 0, skipped: 0, errors: 0 };
    }

    // Enumerate all active positions for this wallet
    const activePositions = await enumerateWalletPositions(
      client,
      walletAddress,
      chainId,
    );

    if (activePositions.length === 0) {
      this.logger.debug(
        { userId, chainId },
        'No active positions found on chain',
      );
      return { found: 0, imported: 0, skipped: 0, errors: 0 };
    }

    this.logger.info(
      { userId, chainId, count: activePositions.length },
      'Active positions found, importing',
    );

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Process positions sequentially within each chain
    for (const pos of activePositions) {
      try {
        // Check if position already exists
        const positionHash = `uniswapv3/${chainId}/${pos.nftId}`;
        const existing = await prisma.position.findFirst({
          where: { userId, positionHash },
          select: { id: true },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Discover + publish position.created in same transaction
        await prisma.$transaction(
          async (tx) => {
            const position = await this.positionService.discover(
              userId,
              { chainId, nftId: pos.nftId },
              tx,
            );

            const eventPublisher = getDomainEventPublisher();
            await eventPublisher.createAndPublish<PositionCreatedPayload>(
              {
                type: 'position.created',
                entityType: 'position',
                entityId: position.id,
                userId: position.userId,
                payload: position.toJSON(),
                source: 'business-logic',
                causedBy: event.id,
              },
              tx,
            );

            this.logger.info(
              { userId, chainId, nftId: pos.nftId, positionId: position.id },
              'Position discovered and position.created event published',
            );
          },
          { timeout: 120_000 },
        );

        imported++;
      } catch (error) {
        errors++;
        this.logger.error(
          {
            userId,
            chainId,
            nftId: pos.nftId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to discover position',
        );
      }
    }

    return { found: activePositions.length, imported, skipped, errors };
  }
}
