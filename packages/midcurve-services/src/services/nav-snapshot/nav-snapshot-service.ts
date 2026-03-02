/**
 * NavSnapshotService
 *
 * CRUD operations and generation logic for daily NAV (Net Asset Value) snapshots.
 *
 * Generation flow (generateSnapshot):
 *
 * Phase A — Refresh positions:
 *   1. Load active positions with pool + token relations
 *   2. Group by chainId, resolve midnight block via Etherscan
 *   3. Batch-query subgraph for pool sqrtPriceX96 and tick
 *   4. Batch-query subgraph for position liquidity
 *   5. Batch collect() staticcall at midnight block for unclaimed fees
 *   6. Subtract uncollected principal (from ledger) to isolate pure fees
 *   7. Compute currentValue, unrealizedPnl, unClaimedFees per position
 *   8. Update Position model fields and publish position.state.refreshed events
 *
 * Phase B — CoinGecko rates:
 *   9. Collect unique quote token CoinGecko IDs across all positions
 *  10. Fetch historical USD prices at midnight UTC for the snapshot date
 *
 * Phase C — NAV snapshots:
 *  11. Group positions by userId
 *  12. Convert position values to reporting currency
 *  13. Aggregate totals and create NAVSnapshot per user
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import {
  getTokenAmountsFromLiquidity,
  ACCOUNT_CODES,
  type PositionBreakdownItem,
} from '@midcurve/shared';
import { getCalendarPeriodBoundaries } from '@midcurve/shared';
import type { CalendarPeriod } from '@midcurve/shared';
import type { Address } from 'viem';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { getEvmConfig } from '../../config/evm.js';
import {
  getPositionManagerAddress,
  UNISWAP_V3_POSITION_MANAGER_ABI,
} from '../../config/uniswapv3.js';
import { EtherscanClient } from '../../clients/etherscan/index.js';
import { UniswapV3SubgraphClient } from '../../clients/subgraph/uniswapv3/index.js';
import { CoinGeckoClient } from '../../clients/coingecko/index.js';
import { getDomainEventPublisher } from '../../events/publisher.js';
import type { PositionStateRefreshedPayload } from '../../events/types.js';
import { calculateTokenValueInQuote } from '../../utils/uniswapv3/ledger-calculations.js';
import { convertToReportingCurrency } from '../../utils/accounting/reporting-currency.js';
import { JournalService } from '../journal/journal-service.js';
import { UniswapV3LedgerService } from '../position-ledger/uniswapv3-ledger-service.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum uint128 value for collect() MAX amounts */
const MAX_UINT128 = 2n ** 128n - 1n;

/** Batch size for parallel collect() staticcalls */
const NFPM_BATCH_SIZE = 50;

// =============================================================================
// Types
// =============================================================================

export interface NavSnapshotServiceDependencies {
  prisma?: PrismaClient;
}

export interface CreateNavSnapshotInput {
  userId: string;
  snapshotDate: Date;
  snapshotType: 'daily' | 'manual';
  reportingCurrency: string;
  valuationMethod: string;
  totalAssets: string;
  totalLiabilities: string;
  netAssetValue: string;
  depositedLiquidityAtCost: string;
  markToMarketAdjustment: string;
  unclaimedFees: string;
  contributedCapital: string;
  capitalReturned: string;
  retainedRealizedWithdrawals: string;
  retainedRealizedFees: string;
  retainedUnrealizedPrice: string;
  retainedUnrealizedFees: string;
  activePositionCount: number;
  positionBreakdown: PositionBreakdownItem[];
}

export interface GenerateSnapshotOptions {
  /** Snapshot date (defaults to today's midnight UTC) */
  snapshotDate?: Date;
  /** If provided, only snapshot this user's positions */
  userId?: string;
}

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
  state: { liquidity: string; ownerAddress: string };
  pool: {
    id: string;
    config: { address: string; chainId: number };
    token0: { decimals: number; coingeckoId: string | null; symbol: string };
    token1: { decimals: number; coingeckoId: string | null; symbol: string };
  };
}

/** Computed values for a position after subgraph + RPC refresh */
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

// =============================================================================
// Service
// =============================================================================

export class NavSnapshotService {
  private static instance: NavSnapshotService | null = null;

  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;
  private readonly journalService: JournalService;
  private readonly subgraphClient: UniswapV3SubgraphClient;
  private readonly etherscanClient: EtherscanClient;

  constructor(deps?: NavSnapshotServiceDependencies) {
    this.prisma = (deps?.prisma ?? prismaClient) as PrismaClient;
    this.logger = createServiceLogger('NavSnapshotService');
    this.journalService = JournalService.getInstance();
    this.subgraphClient = UniswapV3SubgraphClient.getInstance();
    this.etherscanClient = EtherscanClient.getInstance();
  }

  static getInstance(deps?: NavSnapshotServiceDependencies): NavSnapshotService {
    if (!NavSnapshotService.instance) {
      NavSnapshotService.instance = new NavSnapshotService(deps);
    }
    return NavSnapshotService.instance;
  }

  // ===========================================================================
  // Generate snapshot (full orchestration)
  // ===========================================================================

  /**
   * Generates NAV snapshots: refreshes positions, fetches prices, creates snapshots.
   *
   * @param options.snapshotDate - Date to snapshot (defaults to today's midnight UTC)
   * @param options.userId - If provided, only process this user's positions
   */
  async generateSnapshot(options?: GenerateSnapshotOptions): Promise<void> {
    const snapshotDate = options?.snapshotDate ?? getMidnightUTC();
    const userId = options?.userId;

    this.logger.info(
      { snapshotDate: snapshotDate.toISOString(), userId: userId ?? 'all' },
      'Starting NAV snapshot generation'
    );
    const startTime = Date.now();

    // Load active positions with pool + token relations
    const whereClause: Record<string, unknown> = {
      isActive: true,
      positionHash: { not: null },
    };
    if (userId) {
      whereClause.userId = userId;
    }

    const rawPositions = await this.prisma.position.findMany({
      where: whereClause,
      include: {
        pool: {
          include: {
            token0: true,
            token1: true,
          },
        },
      },
    });

    const positions = rawPositions.filter(
      (p) => p.positionHash !== null
    ) as unknown as PositionWithRelations[];

    this.logger.info(
      { positionCount: positions.length },
      'Loaded active positions for snapshot'
    );

    if (positions.length === 0) {
      this.logger.info('No active positions, skipping snapshot');
      return;
    }

    // Phase A: Refresh positions with subgraph data + collect() staticcall
    const refreshedPositions = await this.refreshPositions(positions, snapshotDate);

    // Phase B: Fetch historical CoinGecko rates for the snapshot date
    const usdPrices = await this.fetchCoinGeckoPrices(positions, snapshotDate);

    // Phase C: Create NAV snapshots per user
    await this.persistSnapshots(refreshedPositions, usdPrices, snapshotDate);

    const durationMs = Date.now() - startTime;
    this.logger.info(
      { durationMs, positionCount: positions.length },
      'NAV snapshot generation completed'
    );
  }

  // ===========================================================================
  // Phase A: Refresh positions
  // ===========================================================================

  private async refreshPositions(
    positions: PositionWithRelations[],
    snapshotDate: Date
  ): Promise<RefreshedPositionData[]> {
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

    const chainResults = await Promise.all(
      [...byChain.entries()].map(([chainId, chainPositions]) =>
        this.refreshChainPositions(chainId, chainPositions, snapshotDate)
      )
    );

    return chainResults.flat();
  }

  private async refreshChainPositions(
    chainId: number,
    positions: PositionWithRelations[],
    snapshotDate: Date
  ): Promise<RefreshedPositionData[]> {
    // Step 1: Resolve midnight block number
    const midnightTimestamp = Math.floor(snapshotDate.getTime() / 1000);
    const blockNumberStr = await this.etherscanClient.getBlockNumberForTimestamp(
      chainId, midnightTimestamp, 'before'
    );
    const midnightBlock = BigInt(blockNumberStr);
    const midnightBlockNumber = parseInt(blockNumberStr, 10);

    this.logger.info(
      { chainId, midnightBlock: blockNumberStr, snapshotDate: snapshotDate.toISOString() },
      'Resolved midnight block number'
    );

    // Step 2: Batch-query subgraph for pool slot0 data
    const uniquePoolAddresses = [...new Set(positions.map((p) => p.pool.config.address))];
    const slot0Map = await this.subgraphClient.getPoolsSlot0Batch(chainId, uniquePoolAddresses);

    // Step 3: Batch-query subgraph for position liquidity
    const nftIds = positions.map((p) => p.config.nftId.toString());
    const positionMap = await this.subgraphClient.getPositionsLiquidityBatch(chainId, nftIds);

    // Step 4: Batch collect() staticcalls at midnight block
    const nfpmAddress = getPositionManagerAddress(chainId);
    const evmConfig = getEvmConfig();
    const client = evmConfig.getPublicClient(chainId);

    const collectResults = await this.batchCollectStaticCalls(
      client, nfpmAddress, positions, midnightBlock
    );

    // Step 5: Compute values and update DB + publish events
    const results: RefreshedPositionData[] = [];
    const publisher = getDomainEventPublisher();

    for (const position of positions) {
      const nftId = position.config.nftId.toString();
      const posData = positionMap.get(nftId);
      if (!posData) {
        this.logger.warn(
          { positionId: position.id, nftId },
          'Position not found in subgraph, skipping'
        );
        continue;
      }

      const poolAddress = position.pool.config.address.toLowerCase();
      const slot0 = slot0Map.get(poolAddress);
      if (!slot0) {
        this.logger.warn(
          { positionId: position.id, poolAddress },
          'Pool slot0 data not available from subgraph, skipping'
        );
        continue;
      }

      const collectResult = collectResults.get(position.id);
      if (!collectResult) {
        this.logger.warn(
          { positionId: position.id, nftId },
          'collect() staticcall failed for position, skipping'
        );
        continue;
      }

      const sqrtPriceX96 = slot0.sqrtPriceX96;
      const liquidity = posData.liquidity;

      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        position.config.tickLower,
        position.config.tickUpper,
        false
      );

      const currentValue = calculateTokenValueInQuote(
        token0Amount,
        token1Amount,
        sqrtPriceX96,
        position.isToken0Quote,
        position.pool.token0.decimals,
        position.pool.token1.decimals
      );

      const costBasis = BigInt(position.currentCostBasis);
      const unrealizedPnl = currentValue - costBasis;

      // Subtract uncollected principal from collect() result to isolate pure fees.
      // collect() returns fees + uncollected principal (from previous burns).
      const ledgerService = new UniswapV3LedgerService({ positionId: position.id });
      const { uncollectedPrincipal0, uncollectedPrincipal1 } =
        await ledgerService.fetchUncollectedPrincipals(midnightBlockNumber);

      const pureFee0 = collectResult.tokensOwed0 - uncollectedPrincipal0;
      const pureFee1 = collectResult.tokensOwed1 - uncollectedPrincipal1;

      const unClaimedFees = calculateTokenValueInQuote(
        pureFee0,
        pureFee1,
        sqrtPriceX96,
        position.isToken0Quote,
        position.pool.token0.decimals,
        position.pool.token1.decimals
      );

      // Update Position in DB and publish event in a transaction
      await this.prisma.$transaction(async (tx) => {
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
        tokensOwed0: collectResult.tokensOwed0,
        tokensOwed1: collectResult.tokensOwed1,
      });
    }

    this.logger.info(
      { chainId, refreshedCount: results.length, totalCount: positions.length },
      'Chain positions refreshed via subgraph + collect() staticcall'
    );

    return results;
  }

  private async batchCollectStaticCalls(
    client: ReturnType<ReturnType<typeof getEvmConfig>['getPublicClient']>,
    nfpmAddress: Address,
    positions: PositionWithRelations[],
    blockNumber: bigint
  ): Promise<Map<string, { tokensOwed0: bigint; tokensOwed1: bigint }>> {
    const results = new Map<string, { tokensOwed0: bigint; tokensOwed1: bigint }>();

    for (let i = 0; i < positions.length; i += NFPM_BATCH_SIZE) {
      const batch = positions.slice(i, i + NFPM_BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (position) => {
          const ownerAddress = position.state.ownerAddress as Address;
          try {
            const result = await client.simulateContract({
              address: nfpmAddress,
              abi: UNISWAP_V3_POSITION_MANAGER_ABI,
              functionName: 'collect',
              args: [{
                tokenId: BigInt(position.config.nftId),
                recipient: ownerAddress,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128,
              }],
              blockNumber,
              account: ownerAddress,
            });
            return {
              positionId: position.id,
              tokensOwed0: result.result[0],
              tokensOwed1: result.result[1],
            };
          } catch (error) {
            // Position may not exist at this block (minted later, or already burned)
            this.logger.warn(
              { positionId: position.id, nftId: position.config.nftId, blockNumber: blockNumber.toString(),
                error: error instanceof Error ? error.message : String(error) },
              'collect() staticcall reverted, position likely did not exist at snapshot block'
            );
            return null;
          }
        })
      );

      for (const r of batchResults) {
        if (!r) continue;
        results.set(r.positionId, {
          tokensOwed0: r.tokensOwed0,
          tokensOwed1: r.tokensOwed1,
        });
      }
    }

    return results;
  }

  // ===========================================================================
  // Phase B: CoinGecko rates
  // ===========================================================================

  private async fetchCoinGeckoPrices(
    positions: PositionWithRelations[],
    snapshotDate: Date
  ): Promise<Map<string, number>> {
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
    const priceMap = new Map<string, number>();

    await Promise.all(
      [...coingeckoIds].map(async (coinId) => {
        const { usd } = await client.getHistoricalPrice(coinId, snapshotDate);
        priceMap.set(coinId, usd);
      })
    );

    this.logger.info(
      { tokenCount: priceMap.size, snapshotDate: snapshotDate.toISOString() },
      'Fetched historical CoinGecko USD prices for quote tokens'
    );

    return priceMap;
  }

  // ===========================================================================
  // Phase C: Persist NAV snapshots per user
  // ===========================================================================

  private async persistSnapshots(
    refreshedPositions: RefreshedPositionData[],
    usdPrices: Map<string, number>,
    snapshotDate: Date
  ): Promise<void> {
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { reportingCurrency: true },
    });
    const reportingCurrency = user?.reportingCurrency ?? 'USD';
    const reportingCurrencyUsdPrice = reportingCurrency === 'USD'
      ? 1.0
      : this.getReportingCurrencyUsdPrice(reportingCurrency);

    let totalAssets = 0n;
    const positionBreakdown: PositionBreakdownItem[] = [];

    for (const rp of positions) {
      const quoteToken = rp.position.isToken0Quote
        ? rp.position.pool.token0
        : rp.position.pool.token1;
      const quoteTokenUsdPrice = quoteToken.coingeckoId
        ? (usdPrices.get(quoteToken.coingeckoId) ?? 1.0)
        : 1.0;

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

      const baseToken = rp.position.isToken0Quote
        ? rp.position.pool.token1
        : rp.position.pool.token0;
      const poolSymbol = `${baseToken.symbol}/${quoteToken.symbol}`;

      const unrealizedReporting = rp.unrealizedPnl < 0n
        ? `-${unrealizedConversion.amountReporting}`
        : unrealizedConversion.amountReporting;

      positionBreakdown.push({
        positionRef: rp.position.positionHash,
        instrumentRef: rp.position.positionHash,
        poolSymbol,
        currentValueReporting: valueConversion.amountReporting,
        costBasisReporting: costConversion.amountReporting,
        unrealizedPnlReporting: unrealizedReporting,
        accruedFeesReporting: feesConversion.amountReporting,
      });
    }

    const accountBalances = await this.getUserAccountBalances(positions);

    const totalLiabilities = '0';
    const netAssetValue = totalAssets.toString();

    await this.createSnapshot({
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
      retainedRealizedWithdrawals: (accountBalances.realizedGains + accountBalances.realizedLosses).toString(),
      retainedRealizedFees: accountBalances.feeIncome.toString(),
      retainedUnrealizedPrice: (accountBalances.unrealizedGains + accountBalances.unrealizedLosses).toString(),
      retainedUnrealizedFees: accountBalances.accruedFeeIncome.toString(),
      activePositionCount: positions.length,
      positionBreakdown,
    });
  }

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

  private getReportingCurrencyUsdPrice(reportingCurrency: string): number {
    this.logger.warn(
      { reportingCurrency },
      'Non-USD reporting currency requested; falling back to USD (Phase 1 limitation)'
    );
    return 1.0;
  }

  // ---------------------------------------------------------------------------
  // CRUD: Create
  // ---------------------------------------------------------------------------

  /**
   * Creates or updates (upserts) a NAV snapshot.
   * The unique constraint is (userId, snapshotDate, snapshotType).
   */
  async createSnapshot(input: CreateNavSnapshotInput): Promise<string> {
    const result = await this.prisma.nAVSnapshot.upsert({
      where: {
        userId_snapshotDate_snapshotType: {
          userId: input.userId,
          snapshotDate: input.snapshotDate,
          snapshotType: input.snapshotType,
        },
      },
      create: {
        userId: input.userId,
        snapshotDate: input.snapshotDate,
        snapshotType: input.snapshotType,
        reportingCurrency: input.reportingCurrency,
        valuationMethod: input.valuationMethod,
        totalAssets: input.totalAssets,
        totalLiabilities: input.totalLiabilities,
        netAssetValue: input.netAssetValue,
        depositedLiquidityAtCost: input.depositedLiquidityAtCost,
        markToMarketAdjustment: input.markToMarketAdjustment,
        unclaimedFees: input.unclaimedFees,
        contributedCapital: input.contributedCapital,
        capitalReturned: input.capitalReturned,
        retainedRealizedWithdrawals: input.retainedRealizedWithdrawals,
        retainedRealizedFees: input.retainedRealizedFees,
        retainedUnrealizedPrice: input.retainedUnrealizedPrice,
        retainedUnrealizedFees: input.retainedUnrealizedFees,
        activePositionCount: input.activePositionCount,
        positionBreakdown: input.positionBreakdown as unknown as object[],
      },
      update: {
        reportingCurrency: input.reportingCurrency,
        valuationMethod: input.valuationMethod,
        totalAssets: input.totalAssets,
        totalLiabilities: input.totalLiabilities,
        netAssetValue: input.netAssetValue,
        depositedLiquidityAtCost: input.depositedLiquidityAtCost,
        markToMarketAdjustment: input.markToMarketAdjustment,
        unclaimedFees: input.unclaimedFees,
        contributedCapital: input.contributedCapital,
        capitalReturned: input.capitalReturned,
        retainedRealizedWithdrawals: input.retainedRealizedWithdrawals,
        retainedRealizedFees: input.retainedRealizedFees,
        retainedUnrealizedPrice: input.retainedUnrealizedPrice,
        retainedUnrealizedFees: input.retainedUnrealizedFees,
        activePositionCount: input.activePositionCount,
        positionBreakdown: input.positionBreakdown as unknown as object[],
      },
      select: { id: true },
    });

    this.logger.info(
      `Created NAV snapshot for user ${input.userId} at ${input.snapshotDate.toISOString()}`
    );
    return result.id;
  }

  // ---------------------------------------------------------------------------
  // CRUD: Read
  // ---------------------------------------------------------------------------

  async getLatestSnapshot(userId: string) {
    return this.prisma.nAVSnapshot.findFirst({
      where: { userId },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  async getSnapshotByDate(userId: string, date: Date) {
    return this.prisma.nAVSnapshot.findFirst({
      where: {
        userId,
        snapshotDate: { lte: date },
      },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  async getSnapshotRange(userId: string, startDate: Date, endDate: Date) {
    return this.prisma.nAVSnapshot.findMany({
      where: {
        userId,
        snapshotDate: { gte: startDate, lte: endDate },
      },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  async getSnapshotAtBoundary(userId: string, date: Date) {
    return this.prisma.nAVSnapshot.findFirst({
      where: {
        userId,
        snapshotDate: { lte: date },
      },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  async getComparisonSnapshots(userId: string, period: CalendarPeriod) {
    const current = await this.getLatestSnapshot(userId);
    if (!current) return { current: null, previous: null };

    const { previousEnd } = getCalendarPeriodBoundaries(period);
    const previous = await this.getSnapshotAtBoundary(userId, previousEnd);

    return { current, previous };
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function getMidnightUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}
