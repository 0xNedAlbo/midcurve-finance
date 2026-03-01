/**
 * DailyNavSnapshotRule
 *
 * Midnight UTC cron that refreshes all active positions and creates daily
 * NAV (Net Asset Value) snapshots per user with reporting currency conversion.
 *
 * Execution flow:
 *
 * Phase A — Refresh positions:
 *   1. Load all active positions with pool + token relations
 *   2. Group by chainId, batch-read pool slot0 for fresh sqrtPriceX96
 *   3. Batch-read NFPM positions() for tokensOwed0/tokensOwed1
 *   4. Compute currentValue, unrealizedPnl, unClaimedFees per position
 *   5. Update Position model fields and publish position.state.refreshed events
 *
 * Phase B — CoinGecko rates:
 *   6. Collect unique quote token CoinGecko IDs across all positions
 *   7. Single getSimplePrices() call for USD prices
 *
 * Phase C — NAV snapshots:
 *   8. Group positions by userId
 *   9. Convert position values to reporting currency
 *  10. Aggregate totals and create NAVSnapshot per user
 */

import { prisma } from '@midcurve/database';
import type { Address, PublicClient } from 'viem';
import {
  getTokenAmountsFromLiquidity,
  ACCOUNT_CODES,
  type PositionBreakdownItem,
} from '@midcurve/shared';
import {
  EvmConfig,
  readPoolSlot0Batch,
  type PoolSlot0Result,
  calculateTokenValueInQuote,
  getPositionManagerAddress,
  UNISWAP_V3_POSITION_MANAGER_ABI,
  getDomainEventPublisher,
  CoinGeckoClient,
  NavSnapshotService,
  JournalService,
  convertToReportingCurrency,
  type PositionStateRefreshedPayload,
} from '@midcurve/services';
import { BusinessRule } from '../base';
import { ruleLog } from '../../lib/logger';

// =============================================================================
// Constants
// =============================================================================

const NFPM_BATCH_SIZE = 50;

// =============================================================================
// Types
// =============================================================================

/** Position row with pool + token relations from DB query */
interface PositionWithRelations {
  id: string;
  userId: string;
  positionHash: string;
  isToken0Quote: boolean;
  currentCostBasis: string;
  currentValue: string;
  unrealizedPnl: string;
  unClaimedFees: string;
  config: { chainId: number; nftId: number; tickLower: number; tickUpper: number };
  state: { liquidity: string };
  pool: {
    id: string;
    config: { address: string; chainId: number };
    token0: { decimals: number; coingeckoId: string | null; symbol: string };
    token1: { decimals: number; coingeckoId: string | null; symbol: string };
  };
}

/** Computed values for a position after on-chain refresh */
interface RefreshedPositionData {
  position: PositionWithRelations;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  currentValue: bigint;
  unrealizedPnl: bigint;
  unClaimedFees: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

// =============================================================================
// Rule Implementation
// =============================================================================

export class DailyNavSnapshotRule extends BusinessRule {
  readonly ruleName = 'daily-nav-snapshot';
  readonly ruleDescription =
    'Refreshes active positions and creates daily NAV snapshots with reporting currency';

  private readonly navSnapshotService: NavSnapshotService;
  private readonly journalService: JournalService;

  constructor() {
    super();
    this.navSnapshotService = NavSnapshotService.getInstance();
    this.journalService = JournalService.getInstance();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected async onStartup(): Promise<void> {
    this.registerSchedule(
      '0 0 * * *', // midnight UTC
      'Daily NAV snapshot and position refresh',
      () => this.execute(),
      { timezone: 'UTC', runOnStart: false }
    );

    this.logger.info(
      { schedule: '0 0 * * * (UTC)' },
      'Registered daily NAV snapshot schedule'
    );
  }

  protected async onShutdown(): Promise<void> {
    // Schedules auto-cleanup by base class
  }

  // ===========================================================================
  // Main execution
  // ===========================================================================

  private async execute(): Promise<void> {
    ruleLog.eventProcessing(this.logger, this.ruleName, 'daily-snapshot', 'all-users');
    const startTime = Date.now();

    // Load all active positions with pool + token relations
    const rawPositions = await prisma.position.findMany({
      where: {
        isActive: true,
        positionHash: { not: null },
      },
      include: {
        pool: {
          include: {
            token0: true,
            token1: true,
          },
        },
      },
    });

    // Cast to typed interface (config/state are JSON columns)
    const positions = rawPositions.filter((p) => p.positionHash !== null) as unknown as PositionWithRelations[];

    this.logger.info(
      { positionCount: positions.length },
      'Loaded active positions for daily snapshot'
    );

    if (positions.length === 0) {
      this.logger.info('No active positions, skipping snapshot');
      ruleLog.eventProcessed(this.logger, this.ruleName, 'daily-snapshot', 'all-users', Date.now() - startTime);
      return;
    }

    // Phase A: Refresh positions with on-chain data
    const refreshedPositions = await this.refreshPositions(positions);

    // Phase B: Fetch CoinGecko rates
    const usdPrices = await this.fetchCoinGeckoPrices(positions);

    // Phase C: Create NAV snapshots per user
    await this.createSnapshots(refreshedPositions, usdPrices);

    const durationMs = Date.now() - startTime;
    this.logger.info(
      { durationMs, positionCount: positions.length },
      'Daily NAV snapshot completed'
    );
    ruleLog.eventProcessed(this.logger, this.ruleName, 'daily-snapshot', 'all-users', durationMs);
  }

  // ===========================================================================
  // Phase A: Refresh positions
  // ===========================================================================

  private async refreshPositions(
    positions: PositionWithRelations[]
  ): Promise<RefreshedPositionData[]> {
    // Group positions by chainId
    const byChain = new Map<number, PositionWithRelations[]>();
    for (const p of positions) {
      const chainId = p.config.chainId;
      let list = byChain.get(chainId);
      if (!list) {
        list = [];
        byChain.set(chainId, list);
      }
      list.push(p);
    }

    // Process all chains in parallel
    const chainResults = await Promise.all(
      [...byChain.entries()].map(([chainId, chainPositions]) =>
        this.refreshChainPositions(chainId, chainPositions)
      )
    );

    return chainResults.flat();
  }

  /**
   * Refreshes all positions on a single chain:
   * 1. Batch-read pool slot0 for fresh sqrtPriceX96
   * 2. Batch-read NFPM positions() for liquidity and tokensOwed
   * 3. Compute values and publish events
   */
  private async refreshChainPositions(
    chainId: number,
    positions: PositionWithRelations[]
  ): Promise<RefreshedPositionData[]> {
    const evmConfig = EvmConfig.getInstance();
    const client = evmConfig.getPublicClient(chainId);

    // Step 1: Batch-read pool slot0
    const uniquePoolAddresses = [...new Set(positions.map((p) => p.pool.config.address))];
    const slot0Results = await readPoolSlot0Batch(client, uniquePoolAddresses);
    const slot0Map = new Map<string, PoolSlot0Result>();
    for (const r of slot0Results) {
      slot0Map.set(r.address.toLowerCase(), r);
    }

    // Step 2: Batch-read NFPM positions() for tokensOwed0/tokensOwed1
    const nfpmData = await this.batchReadNfpmPositions(client, chainId, positions);

    // Step 3: Compute values and update DB + publish events
    const results: RefreshedPositionData[] = [];
    const publisher = getDomainEventPublisher();

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i]!;
      const nfpm = nfpmData[i];
      if (!nfpm) {
        this.logger.warn(
          { positionId: position.id, nftId: position.config.nftId },
          'NFPM position data not available, skipping'
        );
        continue;
      }

      const poolAddress = position.pool.config.address.toLowerCase();
      const slot0 = slot0Map.get(poolAddress);
      if (!slot0) {
        this.logger.warn(
          { positionId: position.id, poolAddress },
          'Pool slot0 data not available, skipping'
        );
        continue;
      }

      const sqrtPriceX96 = slot0.sqrtPriceX96;
      const liquidity = nfpm.liquidity;
      const tokensOwed0 = nfpm.tokensOwed0;
      const tokensOwed1 = nfpm.tokensOwed1;

      // Compute token amounts from liquidity
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        position.config.tickLower,
        position.config.tickUpper,
        false
      );

      // Compute current value in quote token
      const currentValue = calculateTokenValueInQuote(
        token0Amount,
        token1Amount,
        sqrtPriceX96,
        position.isToken0Quote,
        position.pool.token0.decimals,
        position.pool.token1.decimals
      );

      // Compute unrealized P&L
      const costBasis = BigInt(position.currentCostBasis);
      const unrealizedPnl = currentValue - costBasis;

      // Compute unclaimed fees in quote token
      const unClaimedFees = calculateTokenValueInQuote(
        tokensOwed0,
        tokensOwed1,
        sqrtPriceX96,
        position.isToken0Quote,
        position.pool.token0.decimals,
        position.pool.token1.decimals
      );

      // Update Position in DB and publish event in a transaction
      await prisma.$transaction(async (tx) => {
        await tx.position.update({
          where: { id: position.id },
          data: {
            currentValue: currentValue.toString(),
            unrealizedPnl: unrealizedPnl.toString(),
            unClaimedFees: unClaimedFees.toString(),
          },
        });

        const payload: PositionStateRefreshedPayload = {
          positionId: position.id,
          positionHash: position.positionHash,
          poolId: position.pool.id,
          chainId,
          nftId: position.config.nftId.toString(),
          liquidity: liquidity.toString(),
          currentValue: currentValue.toString(),
          unrealizedPnl: unrealizedPnl.toString(),
          unClaimedFees: unClaimedFees.toString(),
        };

        await publisher.createAndPublish(
          {
            type: 'position.state.refreshed',
            entityId: position.id,
            entityType: 'position',
            userId: position.userId,
            payload,
            source: 'business-logic',
          },
          tx
        );
      });

      results.push({
        position,
        sqrtPriceX96,
        liquidity,
        currentValue,
        unrealizedPnl,
        unClaimedFees,
        tokensOwed0,
        tokensOwed1,
      });
    }

    this.logger.info(
      { chainId, refreshedCount: results.length, totalCount: positions.length },
      'Chain positions refreshed'
    );

    return results;
  }

  /**
   * Batch-read NFPM positions() via multicall.
   * Returns an array in the same order as input positions.
   * null entries indicate read failures (will be skipped).
   */
  private async batchReadNfpmPositions(
    client: PublicClient,
    chainId: number,
    positions: PositionWithRelations[]
  ): Promise<(NfpmPositionResult | null)[]> {
    const nfpmAddress = getPositionManagerAddress(chainId) as Address;
    const results: (NfpmPositionResult | null)[] = [];

    for (let offset = 0; offset < positions.length; offset += NFPM_BATCH_SIZE) {
      const batch = positions.slice(offset, offset + NFPM_BATCH_SIZE);

      const multicallContracts = batch.map((p) => ({
        address: nfpmAddress,
        abi: UNISWAP_V3_POSITION_MANAGER_ABI,
        functionName: 'positions' as const,
        args: [BigInt(p.config.nftId)] as const,
      }));

      const batchResults = await client.multicall({
        contracts: multicallContracts,
        allowFailure: true,
      });

      for (let j = 0; j < batch.length; j++) {
        const r = batchResults[j];
        if (!r || r.status === 'failure' || !r.result) {
          results.push(null);
          continue;
        }

        // positions() returns a tuple: [nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, fg0, fg1, tokensOwed0, tokensOwed1]
        const data = r.result as readonly [
          bigint, // nonce
          string, // operator
          string, // token0
          string, // token1
          number, // fee
          number, // tickLower
          number, // tickUpper
          bigint, // liquidity
          bigint, // feeGrowthInside0LastX128
          bigint, // feeGrowthInside1LastX128
          bigint, // tokensOwed0
          bigint, // tokensOwed1
        ];

        results.push({
          liquidity: data[7],
          tokensOwed0: data[10],
          tokensOwed1: data[11],
        });
      }
    }

    return results;
  }

  // ===========================================================================
  // Phase B: CoinGecko rates
  // ===========================================================================

  /**
   * Fetches USD prices for all unique quote tokens across positions.
   * Returns a map of coingeckoId → USD price.
   */
  private async fetchCoinGeckoPrices(
    positions: PositionWithRelations[]
  ): Promise<Map<string, number>> {
    // Collect unique coingeckoIds for quote tokens
    const coingeckoIds = new Set<string>();
    for (const p of positions) {
      const quoteToken = p.isToken0Quote ? p.pool.token0 : p.pool.token1;
      if (quoteToken.coingeckoId) {
        coingeckoIds.add(quoteToken.coingeckoId);
      }
    }

    if (coingeckoIds.size === 0) {
      return new Map();
    }

    const client = CoinGeckoClient.getInstance();
    const prices = await client.getSimplePrices([...coingeckoIds]);

    const priceMap = new Map<string, number>();
    for (const [coinId, data] of Object.entries(prices)) {
      priceMap.set(coinId, data.usd);
    }

    this.logger.info(
      { tokenCount: priceMap.size },
      'Fetched CoinGecko USD prices for quote tokens'
    );

    return priceMap;
  }

  // ===========================================================================
  // Phase C: Create NAV snapshots per user
  // ===========================================================================

  private async createSnapshots(
    refreshedPositions: RefreshedPositionData[],
    usdPrices: Map<string, number>
  ): Promise<void> {
    // Group by userId
    const byUser = new Map<string, RefreshedPositionData[]>();
    for (const rp of refreshedPositions) {
      const userId = rp.position.userId;
      let list = byUser.get(userId);
      if (!list) {
        list = [];
        byUser.set(userId, list);
      }
      list.push(rp);
    }

    const snapshotDate = getMidnightUTC();

    for (const [userId, userPositions] of byUser.entries()) {
      await this.createUserSnapshot(userId, userPositions, usdPrices, snapshotDate);
    }

    this.logger.info(
      { userCount: byUser.size },
      'Created NAV snapshots for all users'
    );
  }

  private async createUserSnapshot(
    userId: string,
    positions: RefreshedPositionData[],
    usdPrices: Map<string, number>,
    snapshotDate: Date
  ): Promise<void> {
    // Look up user's reporting currency
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { reportingCurrency: true },
    });
    const reportingCurrency = user?.reportingCurrency ?? 'USD';

    // Get reporting currency USD price (1.0 for USD)
    const reportingCurrencyUsdPrice = reportingCurrency === 'USD' ? 1.0 : await this.getReportingCurrencyUsdPrice(reportingCurrency);

    let totalAssets = 0n;
    const positionBreakdown: PositionBreakdownItem[] = [];

    for (const rp of positions) {
      const quoteToken = rp.position.isToken0Quote
        ? rp.position.pool.token0
        : rp.position.pool.token1;
      const quoteTokenUsdPrice = quoteToken.coingeckoId
        ? (usdPrices.get(quoteToken.coingeckoId) ?? 1.0)
        : 1.0;

      // Convert currentValue to reporting currency
      const valueConversion = convertToReportingCurrency(
        rp.currentValue.toString(),
        quoteTokenUsdPrice,
        reportingCurrencyUsdPrice,
        quoteToken.decimals
      );

      const costConversion = convertToReportingCurrency(
        rp.position.currentCostBasis,
        quoteTokenUsdPrice,
        reportingCurrencyUsdPrice,
        quoteToken.decimals
      );

      const unrealizedConversion = convertToReportingCurrency(
        absBigint(rp.unrealizedPnl).toString(),
        quoteTokenUsdPrice,
        reportingCurrencyUsdPrice,
        quoteToken.decimals
      );

      const feesConversion = convertToReportingCurrency(
        rp.unClaimedFees.toString(),
        quoteTokenUsdPrice,
        reportingCurrencyUsdPrice,
        quoteToken.decimals
      );

      totalAssets += BigInt(valueConversion.amountReporting);

      // Build pool symbol for display
      const baseToken = rp.position.isToken0Quote
        ? rp.position.pool.token1
        : rp.position.pool.token0;
      const poolSymbol = `${baseToken.symbol}/${quoteToken.symbol}`;

      // Preserve sign for unrealized PnL
      const unrealizedReporting = rp.unrealizedPnl < 0n
        ? `-${unrealizedConversion.amountReporting}`
        : unrealizedConversion.amountReporting;

      positionBreakdown.push({
        instrumentRef: rp.position.positionHash,
        poolSymbol,
        currentValueReporting: valueConversion.amountReporting,
        costBasisReporting: costConversion.amountReporting,
        unrealizedPnlReporting: unrealizedReporting,
        accruedFeesReporting: feesConversion.amountReporting,
      });
    }

    // Compute cumulative journal balances for the user
    const accountBalances = await this.getUserAccountBalances(positions);

    const totalLiabilities = '0'; // Phase 1: no liabilities
    const netAssetValue = totalAssets.toString();

    // Retained earnings sub-categories
    const retainedRealizedWithdrawals = accountBalances.realizedGains - accountBalances.realizedLosses;
    const retainedRealizedFees = accountBalances.feeIncome;
    const retainedUnrealizedPrice = accountBalances.unrealizedGains - accountBalances.unrealizedLosses;
    const retainedUnrealizedFees = accountBalances.accruedFeeIncome;

    await this.navSnapshotService.createSnapshot({
      userId,
      snapshotDate,
      snapshotType: 'daily',
      reportingCurrency,
      valuationMethod: 'pool_price',
      totalAssets: totalAssets.toString(),
      totalLiabilities,
      netAssetValue,
      depositedLiquidityAtCost: accountBalances.depositedLiquidity.toString(),
      markToMarketAdjustment: accountBalances.markToMarket.toString(),
      unclaimedFees: accountBalances.unclaimedFeesAsset.toString(),
      contributedCapital: accountBalances.contributedCapital.toString(),
      capitalReturned: accountBalances.capitalReturned.toString(),
      retainedRealizedWithdrawals: retainedRealizedWithdrawals.toString(),
      retainedRealizedFees: retainedRealizedFees.toString(),
      retainedUnrealizedPrice: retainedUnrealizedPrice.toString(),
      retainedUnrealizedFees: retainedUnrealizedFees.toString(),
      activePositionCount: positions.length,
      positionBreakdown,
    });
  }

  /**
   * Compute cumulative account balances for a user across all their tracked positions.
   */
  private async getUserAccountBalances(
    positions: RefreshedPositionData[]
  ): Promise<AccountBalances> {
    const totals: AccountBalances = {
      depositedLiquidity: 0n,
      markToMarket: 0n,
      unclaimedFeesAsset: 0n,
      contributedCapital: 0n,
      capitalReturned: 0n,
      feeIncome: 0n,
      accruedFeeIncome: 0n,
      realizedGains: 0n,
      realizedLosses: 0n,
      unrealizedGains: 0n,
      unrealizedLosses: 0n,
    };

    for (const rp of positions) {
      const ref = rp.position.positionHash;

      const [dl, m2m, uf, cc, cr, fi, afi, rg, rl, ug, ul] = await Promise.all([
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_AT_COST, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.ACCRUED_FEE_INCOME, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.CAPITAL_RETURNED, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.FEE_INCOME, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.ACCRUED_FEE_INCOME_REVENUE, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.REALIZED_GAINS, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.REALIZED_LOSSES, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.UNREALIZED_GAINS, ref),
        this.journalService.getAccountBalanceReporting(ACCOUNT_CODES.UNREALIZED_LOSSES, ref),
      ]);

      totals.depositedLiquidity += dl;
      totals.markToMarket += m2m;
      totals.unclaimedFeesAsset += uf;
      totals.contributedCapital += cc;
      totals.capitalReturned += cr;
      totals.feeIncome += fi;
      totals.accruedFeeIncome += afi;
      totals.realizedGains += rg;
      totals.realizedLosses += rl;
      totals.unrealizedGains += ug;
      totals.unrealizedLosses += ul;
    }

    return totals;
  }

  /**
   * For non-USD reporting currencies, look up the USD price of the reporting currency.
   * Falls back to 1.0 if not available.
   */
  private async getReportingCurrencyUsdPrice(reportingCurrency: string): Promise<number> {
    // CoinGecko doesn't have a direct "EUR price" endpoint,
    // but for Phase 1 we only support USD. Future: use forex API or CoinGecko vs_currencies.
    // For now, return 1.0 (USD-only)
    this.logger.warn(
      { reportingCurrency },
      'Non-USD reporting currency requested; falling back to USD (Phase 1 limitation)'
    );
    return 1.0;
  }
}

// =============================================================================
// Types (internal)
// =============================================================================

interface AccountBalances {
  depositedLiquidity: bigint;
  markToMarket: bigint;
  unclaimedFeesAsset: bigint;
  contributedCapital: bigint;
  capitalReturned: bigint;
  feeIncome: bigint;
  accruedFeeIncome: bigint;
  realizedGains: bigint;
  realizedLosses: bigint;
  unrealizedGains: bigint;
  unrealizedLosses: bigint;
}

interface NfpmPositionResult {
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Returns midnight UTC for today */
function getMidnightUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Returns the absolute value of a bigint */
function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}
