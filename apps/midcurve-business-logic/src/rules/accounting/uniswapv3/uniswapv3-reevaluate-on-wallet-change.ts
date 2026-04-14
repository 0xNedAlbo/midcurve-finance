/**
 * UniswapV3ReevaluateOnWalletChangeRule
 *
 * Subscribes to wallet.added and wallet.removed domain events.
 * When a user's wallet set changes, re-evaluates accounting for all
 * their positions affected by the change.
 *
 * ## UniswapV3 NFT positions (both wallet.added and wallet.removed)
 *
 * All NFT positions are re-evaluated because ownership is tracked per-event
 * via isIgnored flags that depend on the full wallet set:
 * 1. Recalculate ledger aggregates (updates isIgnored flags)
 * 2. Delete existing journal entries + token lots
 * 3. Re-backfill from corrected ledger events
 *
 * ## UniswapV3 Vault positions
 *
 * Vault positions are tied to a single ownerAddress. Only positions whose
 * ownerAddress matches the changed wallet are affected:
 * - wallet.removed: delete journal entries + token lots (position stays)
 * - wallet.added: delete + re-backfill accounting for matching vault positions
 *   by emitting position.created to trigger the vault journal entries rule
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
  setupConsumerQueue,
  ROUTING_PATTERNS,
  UserWalletService,
  UniswapV3LedgerService,
  JournalService,
  TokenLotService,
  getDomainEventPublisher,
  type DomainEvent,
  type WalletChangedPayload,
  type PositionLifecyclePayload,
} from '@midcurve/services';
import {
  createErc721TokenHash,
  getUniswapV3NfpmAddress,
} from '@midcurve/shared';
import { BusinessRule } from '../../base';
import { UniswapV3JournalBackfillService } from './uniswapv3-journal-backfill';

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
    'Re-evaluates isIgnored flags and rebuilds accounting when user wallet set changes';

  private consumerTag: string | null = null;
  private readonly userWalletService: UserWalletService;
  private readonly journalService: JournalService;
  private readonly tokenLotService: TokenLotService;
  private readonly backfillService: UniswapV3JournalBackfillService;

  constructor() {
    super();
    this.userWalletService = new UserWalletService();
    this.journalService = JournalService.getInstance();
    this.tokenLotService = TokenLotService.getInstance();
    this.backfillService = UniswapV3JournalBackfillService.getInstance();
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
    const { userId, address } = event.payload;
    const isWalletAdded = event.type === 'wallet.added';

    // 1. Build updated wallet address set (for NFT position recalculation)
    const walletAddresses = await this.buildUserWalletAddresses(userId);
    this.logger.info(
      { userId, walletCount: walletAddresses.size, eventType: event.type },
      'Built updated wallet address set',
    );

    // 2. Re-evaluate UniswapV3 NFT positions (all of them — ownership is per-event)
    await this.reevaluateNftPositions(userId, walletAddresses);

    // 3. Handle vault positions whose ownerAddress matches the changed wallet
    await this.handleVaultPositions(userId, address, isWalletAdded);
  }

  // ===========================================================================
  // NFT Positions — recalculate isIgnored + rebuild accounting
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
      await this.reevaluateNftPosition(position, userId, walletAddresses);
    }

    this.logger.info(
      { userId, positionCount: positions.length },
      'Completed re-evaluation of NFT positions',
    );
  }

  private async reevaluateNftPosition(
    position: { id: string; positionHash: string | null; config: unknown },
    userId: string,
    walletAddresses: Set<string>,
  ): Promise<void> {
    const positionId = position.id;
    const positionHash = position.positionHash;
    const config = position.config as Record<string, unknown>;
    const isToken0Quote = config.isToken0Quote as boolean;
    const tickLower = config.tickLower as number;
    const tickUpper = config.tickUpper as number;
    const chainId = config.chainId as number;
    const nftId = config.nftId as number;
    const poolAddress = config.poolAddress as string;

    this.logger.info({ positionId, positionHash }, 'Re-evaluating NFT position');

    // a. Recalculate ledger aggregates (updates isIgnored flags + financial metrics)
    const ledgerService = new UniswapV3LedgerService({ positionId });
    await ledgerService.recalculateAggregates(
      isToken0Quote,
      walletAddresses,
      tickLower,
      tickUpper,
    );

    // b. Delete existing journal entries for this position
    if (positionHash) {
      const deletedEntries = await this.journalService.deleteEntriesByPositionRef(positionHash);
      this.logger.info(
        { positionId, positionHash, deletedEntries },
        'Deleted journal entries for NFT position',
      );
    }

    // c. Delete existing token lots for this position
    const nfpmAddress = getUniswapV3NfpmAddress(chainId);
    const tokenHash = createErc721TokenHash(chainId, nfpmAddress, nftId.toString());
    const deletedLots = await this.tokenLotService.deleteLotsByTokenHash(userId, tokenHash);
    this.logger.info(
      { positionId, tokenHash, deletedLots },
      'Deleted token lots for NFT position',
    );

    // d. Re-backfill journal entries + token lots from corrected ledger events
    if (positionHash) {
      const instrumentRef = `uniswapv3/${chainId}/${poolAddress}`;
      const result = await this.backfillService.backfillPosition(
        positionId,
        userId,
        positionHash,
        instrumentRef,
      );
      this.logger.info(
        { positionId, positionHash, entriesCreated: result.entriesCreated, eventsProcessed: result.eventsProcessed },
        'Re-backfilled journal entries for NFT position',
      );
    }
  }

  // ===========================================================================
  // Vault Positions — delete accounting, optionally re-backfill
  // ===========================================================================

  private async handleVaultPositions(
    userId: string,
    changedAddress: string,
    isWalletAdded: boolean,
  ): Promise<void> {
    // Find vault positions whose ownerAddress matches the changed wallet
    // ownerAddress is stored in position config JSON
    const vaultPositions = await prisma.position.findMany({
      where: {
        userId,
        protocol: 'uniswapv3-vault',
        config: { path: ['ownerAddress'], equals: changedAddress },
      },
      select: { id: true, positionHash: true, config: true },
    });

    if (vaultPositions.length === 0) {
      this.logger.info(
        { userId, changedAddress },
        'No vault positions match the changed wallet',
      );
      return;
    }

    this.logger.info(
      { userId, changedAddress, positionCount: vaultPositions.length, isWalletAdded },
      'Processing vault positions for wallet change',
    );

    for (const position of vaultPositions) {
      await this.handleVaultPosition(position, userId, isWalletAdded);
    }
  }

  private async handleVaultPosition(
    position: { id: string; positionHash: string | null; config: unknown },
    userId: string,
    isWalletAdded: boolean,
  ): Promise<void> {
    const positionId = position.id;
    const positionHash = position.positionHash;
    const config = position.config as Record<string, unknown>;
    const chainId = config.chainId as number;
    const vaultAddress = config.vaultAddress as string;

    // a. Delete existing journal entries
    if (positionHash) {
      const deletedEntries = await this.journalService.deleteEntriesByPositionRef(positionHash);
      this.logger.info(
        { positionId, positionHash, deletedEntries },
        'Deleted journal entries for vault position',
      );
    }

    // b. Delete existing token lots
    // Vault tokenHash uses createErc721TokenHash(chainId, vaultAddress, vaultAddress)
    const tokenHash = createErc721TokenHash(chainId, vaultAddress, vaultAddress);
    const deletedLots = await this.tokenLotService.deleteLotsByTokenHash(userId, tokenHash);
    this.logger.info(
      { positionId, tokenHash, deletedLots },
      'Deleted token lots for vault position',
    );

    // c. For wallet.added: re-trigger backfill via position.created domain event
    //    The existing UniswapV3VaultPostJournalEntriesRule will handle the backfill.
    //    Its idempotency guard (getOpenLots) passes since we just deleted them.
    if (isWalletAdded && positionHash) {
      const publisher = getDomainEventPublisher();
      await publisher.createAndPublish<PositionLifecyclePayload>({
        type: 'position.created',
        entityId: positionId,
        entityType: 'position',
        userId,
        payload: {
          positionId,
          positionHash,
        },
        source: 'business-logic',
      });
      this.logger.info(
        { positionId, positionHash },
        'Emitted position.created to trigger vault journal backfill',
      );
    }
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
