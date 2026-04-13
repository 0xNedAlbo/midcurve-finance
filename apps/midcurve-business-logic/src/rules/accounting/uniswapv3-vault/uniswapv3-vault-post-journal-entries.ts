/**
 * UniswapV3VaultPostJournalEntriesRule
 *
 * Subscribes to UniswapV3-Vault position domain events and
 * maintains token lot records for cost basis tracking.
 *
 * Vault positions represent shares in a vault that wraps a UniswapV3 NFT.
 * Lot quantity is denominated in vault shares (not liquidity units).
 *
 * Acquisition events (create lots):
 * - position.created           → Backfill lots from ledger history
 * - position.liquidity.increased → Create acquisition lot (VAULT_MINT)
 * - position.transferred.in    → Create acquisition lot (VAULT_TRANSFER_IN)
 *
 * Disposal events (consume lots):
 * - position.liquidity.decreased → Dispose lots (VAULT_BURN)
 * - position.transferred.out   → Dispose lots (VAULT_TRANSFER_OUT)
 *
 * Non-lot events:
 * - position.fees.collected    → Fee income (outside lot system)
 * - position.closed            → Cost basis correction
 * - position.burned            → No financial entry
 * - position.deleted           → Delete all lots for position
 * - position.liquidity.reverted → Delete lots for reverted events
 */

import type { ConsumeMessage } from 'amqplib';
import { prisma } from '@midcurve/database';
import {
  setupConsumerQueue,
  CoinGeckoClient,
  TokenLotService,
  createLotSelector,
  type DomainEvent,
  type PositionEventType,
  type PositionLifecyclePayload,
  type PositionLedgerEventPayload,
  type PositionLiquidityRevertedPayload,
  type DisposalResult,
} from '@midcurve/services';
import {
  createErc20TokenHash,
  createErc721TokenHash,
  type CostBasisMethod,
  DEFAULT_USER_SETTINGS,
} from '@midcurve/shared';
import { BusinessRule } from '../../base';

// =============================================================================
// Constants
// =============================================================================

const QUEUE_NAME = 'business-logic.uniswapv3-vault-post-journal-entries';
const ROUTING_PATTERN = 'positions.*.uniswapv3-vault';
const FLOAT_TO_BIGINT_SCALE = 1e8;

// =============================================================================
// Types
// =============================================================================

interface ReportingContext {
  reportingCurrency: string;
  exchangeRate: string;
  quoteTokenDecimals: number;
  poolHash: string;
}

interface PositionTokenContext {
  tokenId: string;
  tokenHash: string;
}

// =============================================================================
// Rule Implementation
// =============================================================================

export class UniswapV3VaultPostJournalEntriesRule extends BusinessRule {
  readonly ruleName = 'uniswapv3-vault-post-journal-entries';
  readonly ruleDescription =
    'Maintains token lots from UniswapV3 Vault position domain events';

  private consumerTag: string | null = null;
  private readonly tokenLotService: TokenLotService;

  constructor() {
    super();
    this.tokenLotService = TokenLotService.getInstance();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    if (!this.channel) throw new Error('No channel available');

    await setupConsumerQueue(this.channel, QUEUE_NAME, ROUTING_PATTERN);
    await this.channel.prefetch(1);

    const result = await this.channel.consume(
      QUEUE_NAME,
      (msg) => this.handleMessage(msg),
      { noAck: false },
    );

    this.consumerTag = result.consumerTag;
    this.logger.info(
      { queueName: QUEUE_NAME, routingPattern: ROUTING_PATTERN },
      'Subscribed to UniswapV3 Vault position events for token lot tracking',
    );
  }

  protected async onShutdown(): Promise<void> {
    if (this.consumerTag && this.channel) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }
  }

  // ===========================================================================
  // Message Routing
  // ===========================================================================

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    try {
      const event = JSON.parse(msg.content.toString()) as DomainEvent;
      const eventType = event.type as PositionEventType;

      this.logger.info(
        { eventId: event.id, eventType, entityId: event.entityId },
        'Processing vault position event for token lots',
      );

      await this.routeEvent(event, eventType);
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing vault position event for token lots',
      );
      this.channel.nack(msg, false, false);
    }
  }

  private async routeEvent(
    event: DomainEvent,
    eventType: PositionEventType,
  ): Promise<void> {
    switch (eventType) {
      case 'position.created':
        return this.handlePositionCreated(event as DomainEvent<PositionLifecyclePayload>);
      case 'position.liquidity.increased':
        return this.handleLiquidityIncreased(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.liquidity.decreased':
        return this.handleLiquidityDecreased(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.fees.collected':
        return this.handleFeesCollected(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.transferred.in':
        return this.handleTransferredIn(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.transferred.out':
        return this.handleTransferredOut(event as DomainEvent<PositionLedgerEventPayload>);
      case 'position.closed':
        return this.handlePositionClosed(event as DomainEvent<PositionLifecyclePayload>);
      case 'position.burned':
        return;
      case 'position.deleted':
        return this.handlePositionDeleted(event as DomainEvent<PositionLifecyclePayload>);
      case 'position.liquidity.reverted':
        return this.handleLiquidityReverted(event as DomainEvent<PositionLiquidityRevertedPayload>);
      default:
        this.logger.warn({ eventType }, 'Unknown position event type, skipping');
    }
  }

  // ===========================================================================
  // Acquisition Handlers — create lots
  // ===========================================================================

  /**
   * position.created → Backfill lots from vault ledger event history.
   *
   * Vault events use `shares` (config field) instead of `deltaL`.
   * VAULT_MINT / VAULT_TRANSFER_IN → acquisition lots
   * VAULT_BURN / VAULT_TRANSFER_OUT → disposal lots
   */
  private async handlePositionCreated(
    event: DomainEvent<PositionLifecyclePayload>,
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { id: true, userId: true, protocol: true, config: true, state: true },
    });
    if (!position) {
      this.logger.warn({ positionId }, 'Position not found for position.created');
      return;
    }

    // Vault ownership guard
    const positionState = position.state as Record<string, unknown>;
    if (positionState.isOwnedByUser === false) {
      this.logger.info({ positionHash }, 'Skipping backfill — vault position not owned by user');
      return;
    }

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    // Idempotency — skip if lots already exist
    const existingLots = await this.tokenLotService.getOpenLots(position.userId, tokenCtx.tokenHash);
    if (existingLots.length > 0) {
      this.logger.info({ positionHash }, 'Lots already exist for vault position, skipping backfill');
      return;
    }

    const costBasisMethod = await this.getUserCostBasisMethod(position.userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const ledgerEvents = await prisma.positionLedgerEvent.findMany({
      where: {
        positionId,
        eventType: {
          in: [
            'VAULT_MINT', 'VAULT_BURN',
            'VAULT_TRANSFER_IN', 'VAULT_TRANSFER_OUT',
          ],
        },
        isIgnored: false,
      },
      select: {
        id: true,
        eventType: true,
        inputHash: true,
        timestamp: true,
        tokenValue: true,
        deltaCostBasis: true,
        config: true,
      },
      orderBy: { timestamp: 'asc' },
    });

    if (ledgerEvents.length === 0) return;

    const ctx = await this.getReportingContext(positionId);

    for (const le of ledgerEvents) {
      const config = le.config as Record<string, unknown>;
      const shares = config.shares as string;
      if (!shares || shares === '0') continue;

      if (le.eventType === 'VAULT_MINT' || le.eventType === 'VAULT_TRANSFER_IN') {
        const deltaCostBasis = le.deltaCostBasis;
        if (deltaCostBasis === '0') continue;

        const costBasisAbsolute = computeReportingAmount(
          deltaCostBasis, ctx.exchangeRate, ctx.quoteTokenDecimals,
        );

        await this.tokenLotService.createLot({
          userId: position.userId,
          tokenId: tokenCtx.tokenId,
          tokenHash: tokenCtx.tokenHash,
          quantity: shares,
          costBasisAbsolute,
          acquiredAt: le.timestamp,
          acquisitionEventId: le.inputHash,
          transferEvent: le.eventType === 'VAULT_TRANSFER_IN' ? 'TRANSFER_IN' : 'VAULT_MINT',
        });
      } else if (le.eventType === 'VAULT_BURN' || le.eventType === 'VAULT_TRANSFER_OUT') {
        const proceedsReporting = computeReportingAmount(
          le.tokenValue, ctx.exchangeRate, ctx.quoteTokenDecimals,
        );

        await this.tokenLotService.disposeLots({
          userId: position.userId,
          tokenHash: tokenCtx.tokenHash,
          quantityToDispose: shares,
          proceedsReporting,
          disposedAt: le.timestamp,
          disposalEventId: le.inputHash,
          transferEvent: le.eventType === 'VAULT_TRANSFER_OUT' ? 'TRANSFER_OUT' : 'VAULT_BURN',
          lotSelector,
        });
      }
    }

    this.logger.info(
      { positionHash, eventsProcessed: ledgerEvents.length },
      'Token lots backfilled from vault ledger history',
    );

    // TODO: Create journal entries from lots
  }

  /**
   * position.liquidity.increased → Create acquisition lot (VAULT_MINT).
   *
   * Cost basis = combined FMV of deposited tokens.
   * Quantity = vault shares minted.
   */
  private async handleLiquidityIncreased(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for vault mint');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    if (!shares || shares === '0') return;

    const deltaCostBasis = ledgerEvent.deltaCostBasis;
    if (deltaCostBasis === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisAbsolute = computeReportingAmount(
      deltaCostBasis, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    await this.tokenLotService.createLot({
      userId,
      tokenId: tokenCtx.tokenId,
      tokenHash: tokenCtx.tokenHash,
      quantity: shares,
      costBasisAbsolute,
      acquiredAt: new Date(event.payload.eventTimestamp),
      acquisitionEventId: ledgerInputHash,
      transferEvent: 'VAULT_MINT',
    });

    this.logger.info({ positionHash, shares, costBasisAbsolute }, 'Vault acquisition lot created');

    // TODO: Create journal entry (DR 1000 / CR 3000) from lot
  }

  /**
   * position.transferred.in → Create acquisition lot at FMV.
   *
   * Vault share transfers carry `sharesAfter` — the user's total share balance.
   */
  private async handleTransferredIn(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for vault transfer in');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    const costBasis = ledgerEvent.deltaCostBasis;
    if (!shares || shares === '0' || costBasis === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisAbsolute = computeReportingAmount(
      costBasis, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    await this.tokenLotService.createLot({
      userId,
      tokenId: tokenCtx.tokenId,
      tokenHash: tokenCtx.tokenHash,
      quantity: shares,
      costBasisAbsolute,
      acquiredAt: new Date(event.payload.eventTimestamp),
      acquisitionEventId: ledgerInputHash,
      transferEvent: 'TRANSFER_IN',
    });

    this.logger.info({ positionHash, shares }, 'Vault transfer-in acquisition lot created');

    // TODO: Create journal entry (DR 1000 / CR 3000) from lot
  }

  // ===========================================================================
  // Disposal Handlers — consume lots
  // ===========================================================================

  /**
   * position.liquidity.decreased → Dispose lots (VAULT_BURN).
   *
   * Proceeds = FMV of withdrawn tokens.
   * Quantity = vault shares burned.
   */
  private async handleLiquidityDecreased(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId }, 'No ledger event found for vault burn');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    if (!shares || shares === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisMethod = await this.getUserCostBasisMethod(userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const proceedsReporting = computeReportingAmount(
      ledgerEvent.tokenValue, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    const result = await this.tokenLotService.disposeLots({
      userId,
      tokenHash: tokenCtx.tokenHash,
      quantityToDispose: shares,
      proceedsReporting,
      disposedAt: new Date(event.payload.eventTimestamp),
      disposalEventId: ledgerInputHash,
      transferEvent: 'VAULT_BURN',
      lotSelector,
    });

    this.logger.info(
      { positionHash, disposalCount: result.disposals.length, totalPnl: result.totalRealizedPnl.toString() },
      'Lots disposed for vault burn',
    );

    // TODO: Create journal entries from disposal result
    this.logDisposalStub(positionHash, result);
  }

  /**
   * position.transferred.out → Dispose lots for the transferred shares.
   *
   * Unlike NFT transfers, vault share transfers can be partial.
   * Quantity = shares transferred (from config).
   */
  private async handleTransferredOut(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    const { positionId, positionHash, ledgerInputHash } = event.payload;
    const userId = await this.getPositionUserId(positionId);

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    if (!ledgerEvent) {
      this.logger.warn({ positionId, ledgerInputHash }, 'No ledger event found for vault transfer out');
      return;
    }

    const config = ledgerEvent.config as Record<string, unknown>;
    const shares = config.shares as string;
    if (!shares || shares === '0') return;

    const ctx = await this.getReportingContext(positionId);
    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const costBasisMethod = await this.getUserCostBasisMethod(userId);
    const lotSelector = createLotSelector(costBasisMethod);

    const proceedsReporting = computeReportingAmount(
      ledgerEvent.tokenValue, ctx.exchangeRate, ctx.quoteTokenDecimals,
    );

    const result = await this.tokenLotService.disposeLots({
      userId,
      tokenHash: tokenCtx.tokenHash,
      quantityToDispose: shares,
      proceedsReporting,
      disposedAt: new Date(event.payload.eventTimestamp),
      disposalEventId: ledgerInputHash,
      transferEvent: 'TRANSFER_OUT',
      lotSelector,
    });

    this.logger.info(
      { positionHash, totalPnl: result.totalRealizedPnl.toString() },
      'Lots disposed for vault transfer out',
    );

    // TODO: Create journal entries from disposal result
    this.logDisposalStub(positionHash, result);
  }

  // ===========================================================================
  // Non-Lot Handlers
  // ===========================================================================

  /**
   * position.fees.collected → Fee income (outside lot system).
   *
   * TODO: Create journal entry (DR 3100 / CR 4000) directly.
   */
  private async handleFeesCollected(
    event: DomainEvent<PositionLedgerEventPayload>,
  ): Promise<void> {
    const { positionId, positionHash, ledgerInputHash } = event.payload;

    const ledgerEvent = await this.findLedgerEventByInputHash(positionId, ledgerInputHash);
    const totalFees = ledgerEvent ? BigInt(ledgerEvent.deltaCollectedYield) : 0n;
    if (totalFees <= 0n) return;

    this.logger.info(
      { positionHash, totalFees: totalFees.toString() },
      'Vault fee collection event received (journal entry stub)',
    );

    // TODO: Create journal entry for fee income
  }

  /**
   * position.closed → Cost basis correction stub.
   */
  private async handlePositionClosed(
    event: DomainEvent<PositionLifecyclePayload>,
  ): Promise<void> {
    this.logger.info(
      { positionHash: event.payload.positionHash },
      'Vault position closed event received (journal correction stub)',
    );

    // TODO: Create cost basis correction entry from remaining lot state
  }

  /**
   * position.deleted → Delete all lots for this vault position.
   */
  private async handlePositionDeleted(
    event: DomainEvent<PositionLifecyclePayload>,
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { userId: true },
    });
    if (!position) return;

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const count = await this.tokenLotService.deleteLotsByTokenHash(
      position.userId,
      tokenCtx.tokenHash,
    );

    this.logger.info(
      { positionHash, deletedLots: count },
      'Deleted token lots for deleted vault position',
    );

    // TODO: Delete journal entries for position
  }

  /**
   * position.liquidity.reverted → Delete lots for reverted ledger events.
   */
  private async handleLiquidityReverted(
    event: DomainEvent<PositionLiquidityRevertedPayload>,
  ): Promise<void> {
    const { positionId, positionHash } = event.payload;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { userId: true },
    });
    if (!position) return;

    const tokenCtx = await this.resolvePositionToken(positionId);
    if (!tokenCtx) return;

    const existingEvents = await prisma.positionLedgerEvent.findMany({
      where: { positionId },
      select: { inputHash: true },
    });
    const existingHashes = new Set(existingEvents.map((e) => e.inputHash));

    const allLots = await prisma.tokenLot.findMany({
      where: { userId: position.userId, tokenHash: tokenCtx.tokenHash },
      select: { acquisitionEventId: true },
    });
    const orphanedEventIds = allLots
      .filter((lot) => !existingHashes.has(lot.acquisitionEventId))
      .map((lot) => lot.acquisitionEventId);

    if (orphanedEventIds.length > 0) {
      const count = await this.tokenLotService.deleteLotsByAcquisitionEventIds(
        position.userId,
        tokenCtx.tokenHash,
        orphanedEventIds,
      );
      this.logger.info(
        { positionHash, deletedLots: count },
        'Deleted token lots for reverted vault ledger events',
      );
    }

    // TODO: Delete/recreate journal entries for reverted events
  }

  // ===========================================================================
  // Token Resolution
  // ===========================================================================

  /**
   * Resolve or create the Token row for a vault position.
   * tokenHash = "erc721/{chainId}/{vaultAddress}/{vaultAddress}"
   */
  private async resolvePositionToken(positionId: string): Promise<PositionTokenContext | null> {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { config: true },
    });
    if (!position) return null;

    const config = position.config as Record<string, unknown>;
    const chainId = config.chainId as number;
    const vaultAddress = config.vaultAddress as string;
    const tokenHash = createErc721TokenHash(chainId, vaultAddress, vaultAddress);

    const token = await prisma.token.upsert({
      where: { tokenHash },
      update: {},
      create: {
        tokenType: 'erc721',
        name: `UniswapV3 Vault (${vaultAddress.slice(0, 8)}...)`,
        symbol: 'UV3-VAULT',
        decimals: 0,
        tokenHash,
        config: { chainId, protocol: 'uniswapv3-vault' },
      },
      select: { id: true, tokenHash: true },
    });

    return { tokenId: token.id, tokenHash: token.tokenHash };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async findLedgerEventByInputHash(positionId: string, inputHash: string) {
    return prisma.positionLedgerEvent.findFirst({
      where: { positionId, inputHash },
      select: {
        id: true,
        deltaCostBasis: true,
        costBasisAfter: true,
        deltaPnl: true,
        pnlAfter: true,
        deltaCollectedYield: true,
        collectedYieldAfter: true,
        tokenValue: true,
        config: true,
      },
    });
  }

  private async getPositionUserId(positionId: string): Promise<string> {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: { userId: true },
    });
    if (!position) throw new Error(`Position not found: ${positionId}`);
    return position.userId;
  }

  private async getUserCostBasisMethod(userId: string): Promise<CostBasisMethod> {
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { settings: true },
    });
    if (!settings) return DEFAULT_USER_SETTINGS.costBasisMethod;
    const data = settings.settings as Record<string, unknown>;
    return (data.costBasisMethod as CostBasisMethod) ?? DEFAULT_USER_SETTINGS.costBasisMethod;
  }

  private async getReportingContext(positionId: string): Promise<ReportingContext> {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      select: {
        protocol: true,
        config: true,
        user: { select: { reportingCurrency: true } },
      },
    });
    if (!position) throw new Error(`Position not found: ${positionId}`);

    const positionConfig = position.config as Record<string, unknown>;
    const token0Address = positionConfig.token0Address as string;
    const token1Address = positionConfig.token1Address as string;
    const chainId = positionConfig.chainId as number;
    const poolAddress = positionConfig.poolAddress as string;

    const [token0Row, token1Row] = await Promise.all([
      prisma.token.findUnique({
        where: { tokenHash: createErc20TokenHash(chainId, token0Address) },
        select: { decimals: true, coingeckoId: true },
      }),
      prisma.token.findUnique({
        where: { tokenHash: createErc20TokenHash(chainId, token1Address) },
        select: { decimals: true, coingeckoId: true },
      }),
    ]);
    if (!token0Row) throw new Error(`Token not found for address ${token0Address} on chain ${chainId}`);
    if (!token1Row) throw new Error(`Token not found for address ${token1Address} on chain ${chainId}`);

    const isToken0Quote = positionConfig.isToken0Quote as boolean;
    const quoteToken = isToken0Quote ? token0Row : token1Row;
    const reportingCurrency = position.user.reportingCurrency;

    const reportingCurrencyUsdPrice = 1.0;

    let quoteTokenUsdPrice = 1.0;
    if (quoteToken.coingeckoId) {
      const prices = await CoinGeckoClient.getInstance().getSimplePrices([quoteToken.coingeckoId]);
      quoteTokenUsdPrice = prices[quoteToken.coingeckoId]?.usd ?? 1.0;
    }

    const rate = quoteTokenUsdPrice / reportingCurrencyUsdPrice;
    const exchangeRate = BigInt(Math.round(rate * FLOAT_TO_BIGINT_SCALE));

    const poolHash = `uniswapv3-vault/${chainId}/${poolAddress}`;

    return {
      reportingCurrency,
      exchangeRate: exchangeRate.toString(),
      quoteTokenDecimals: quoteToken.decimals,
      poolHash,
    };
  }

  private logDisposalStub(positionHash: string, result: DisposalResult): void {
    this.logger.info(
      {
        positionHash,
        totalCostBasis: result.totalCostBasisAllocated.toString(),
        totalPnl: result.totalRealizedPnl.toString(),
        disposals: result.disposals.length,
      },
      'Journal entry stub: vault disposal results ready for journal creation',
    );
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function computeReportingAmount(
  amountQuote: string,
  exchangeRate: string,
  quoteTokenDecimals: number,
): string {
  const amount = BigInt(amountQuote);
  const rate = BigInt(exchangeRate);
  const scale = 10n ** BigInt(quoteTokenDecimals);
  const absAmount = amount < 0n ? -amount : amount;
  return ((absAmount * rate) / scale).toString();
}
