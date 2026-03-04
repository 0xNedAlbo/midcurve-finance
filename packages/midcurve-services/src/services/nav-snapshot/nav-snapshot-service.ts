/**
 * NavSnapshotService
 *
 * CRUD operations and generation logic for daily NAV (Net Asset Value) snapshots.
 * Snapshots are the single source of truth for all Balance Sheet reporting.
 *
 * Generation flow (generateSnapshot):
 *
 * Phase A — Refresh positions:
 *   1. Load active positions with pool + token relations
 *   2. Group by chainId, resolve midnight block via subgraph positionSnapshots
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
 *  13. Query user-scoped journal balances (11 accounts per user)
 *  14. Compute journalHash and create NAVSnapshot + SnapshotStateCache per user
 *
 * Recomputation flow (recomputeSnapshot):
 *  - Reads cached on-chain state from SnapshotStateCache
 *  - Filters out positions no longer tracked
 *  - Recomputes totalAssets + positionBreakdown from cache
 *  - Queries current user-scoped journal balances
 *  - Updates NAVSnapshot in place with new journalHash
 */

import { createHash } from 'node:crypto';
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
  snapshotType: string;
  journalHash: string;
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
  midnightBlock: string;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  currentValue: bigint;
  unrealizedPnl: bigint;
  unClaimedFees: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  uncollectedPrincipal0: bigint;
  uncollectedPrincipal1: bigint;
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

/** Per-position on-chain state stored in SnapshotStateCache.positionStates JSON */
export interface CachedPositionState {
  positionRef: string;
  poolAddress: string;
  sqrtPriceX96: string;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  uncollectedPrincipal0: string;
  uncollectedPrincipal1: string;
  tickLower: number;
  tickUpper: number;
  token0Decimals: number;
  token1Decimals: number;
  isToken0Quote: boolean;
  currentCostBasis: string;
  quoteTokenCoingeckoId: string | null;
  poolSymbol: string;
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

  constructor(deps?: NavSnapshotServiceDependencies) {
    this.prisma = (deps?.prisma ?? prismaClient) as PrismaClient;
    this.logger = createServiceLogger('NavSnapshotService');
    this.journalService = JournalService.getInstance();
    this.subgraphClient = UniswapV3SubgraphClient.getInstance();
  }

  static getInstance(deps?: NavSnapshotServiceDependencies): NavSnapshotService {
    if (!NavSnapshotService.instance) {
      NavSnapshotService.instance = new NavSnapshotService(deps);
    }
    return NavSnapshotService.instance;
  }

  // ===========================================================================
  // Journal Hash
  // ===========================================================================

  /**
   * Computes a deterministic hash over the set of tracked positions for a user.
   * Used for staleness detection: if the hash changes, affected snapshots need recomputation.
   */
  async computeJournalHash(userId: string): Promise<string> {
    const trackedPositions = await this.prisma.trackedPosition.findMany({
      where: { userId },
      select: { positionRef: true },
      orderBy: { positionRef: 'asc' },
    });

    const payload = trackedPositions.map((tp) => tp.positionRef).join('|');
    return createHash('sha256').update(payload).digest('hex');
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

    // Phase C: Create NAV snapshots + state cache per user
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
    // Step 1: Resolve midnight block number via subgraph (no Etherscan dependency)
    const midnightTimestamp = Math.floor(snapshotDate.getTime() / 1000);
    const blockNumberStr = await this.subgraphClient.getBlockForTimestamp(
      chainId, midnightTimestamp
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
        midnightBlock: blockNumberStr,
        sqrtPriceX96,
        liquidity,
        currentValue,
        unrealizedPnl,
        unClaimedFees,
        tokensOwed0: collectResult.tokensOwed0,
        tokensOwed1: collectResult.tokensOwed1,
        uncollectedPrincipal0,
        uncollectedPrincipal1,
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
  // Phase C: Persist NAV snapshots + state cache per user
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

    // Build per-chain cache data alongside position value computation
    const cacheByChain = new Map<number, {
      midnightBlock: string;
      positionStates: CachedPositionState[];
      quoteTokenPrices: Record<string, number>;
    }>();

    for (const rp of positions) {
      const chainId = rp.position.config.chainId;
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

      // Accumulate cache data per chain
      let chainCache = cacheByChain.get(chainId);
      if (!chainCache) {
        chainCache = {
          midnightBlock: rp.midnightBlock,
          positionStates: [],
          quoteTokenPrices: {},
        };
        cacheByChain.set(chainId, chainCache);
      }

      chainCache.positionStates.push({
        positionRef: rp.position.positionHash,
        poolAddress: rp.position.pool.config.address,
        sqrtPriceX96: rp.sqrtPriceX96.toString(),
        liquidity: rp.liquidity.toString(),
        tokensOwed0: rp.tokensOwed0.toString(),
        tokensOwed1: rp.tokensOwed1.toString(),
        uncollectedPrincipal0: rp.uncollectedPrincipal0.toString(),
        uncollectedPrincipal1: rp.uncollectedPrincipal1.toString(),
        tickLower: rp.position.config.tickLower,
        tickUpper: rp.position.config.tickUpper,
        token0Decimals: rp.position.pool.token0.decimals,
        token1Decimals: rp.position.pool.token1.decimals,
        isToken0Quote: rp.position.isToken0Quote,
        currentCostBasis: rp.position.currentCostBasis,
        quoteTokenCoingeckoId: quoteToken.coingeckoId,
        poolSymbol,
      });

      if (quoteToken.coingeckoId) {
        chainCache.quoteTokenPrices[quoteToken.coingeckoId] = quoteTokenUsdPrice;
      }
    }

    // User-scoped journal balances (replaces old per-position iteration)
    const accountBalances = await this.getUserAccountBalancesForUser(userId, snapshotDate);

    const journalHash = await this.computeJournalHash(userId);

    const totalLiabilities = '0';
    const netAssetValue = totalAssets.toString();

    const snapshotId = await this.createSnapshot({
      userId,
      snapshotDate,
      snapshotType: 'daily',
      journalHash,
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

    // Persist on-chain state cache per chain
    for (const [chainId, chainCache] of cacheByChain.entries()) {
      await this.prisma.snapshotStateCache.upsert({
        where: { snapshotId_chainId: { snapshotId, chainId } },
        create: {
          snapshotId,
          chainId,
          midnightBlock: chainCache.midnightBlock,
          positionStates: chainCache.positionStates as unknown as object[],
          quoteTokenPrices: chainCache.quoteTokenPrices,
        },
        update: {
          midnightBlock: chainCache.midnightBlock,
          positionStates: chainCache.positionStates as unknown as object[],
          quoteTokenPrices: chainCache.quoteTokenPrices,
        },
      });
    }
  }

  /**
   * Queries user-scoped journal balances for all 11 accounts.
   * Single query per account aggregating across all tracked positions.
   */
  private async getUserAccountBalancesForUser(userId: string, asOf: Date): Promise<AccountBalances> {
    const [dl, m2m, uf, cc, cr, fi, afi, rg, rl, ug, ul] = await Promise.all([
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_AT_COST, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.ACCRUED_FEE_INCOME, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CAPITAL_RETURNED, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.FEE_INCOME, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.ACCRUED_FEE_INCOME_REVENUE, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_GAINS, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_LOSSES, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.UNREALIZED_GAINS, userId, asOf),
      this.journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.UNREALIZED_LOSSES, userId, asOf),
    ]);

    return {
      depositedLiquidity: dl,
      markToMarket: m2m,
      unclaimedFeesAsset: uf,
      contributedCapital: cc,
      capitalReturned: cr,
      feeIncome: fi,
      accruedFeeIncome: afi,
      realizedGains: rg,
      realizedLosses: rl,
      unrealizedGains: ug,
      unrealizedLosses: ul,
    };
  }

  private getReportingCurrencyUsdPrice(reportingCurrency: string): number {
    this.logger.warn(
      { reportingCurrency },
      'Non-USD reporting currency requested; falling back to USD (Phase 1 limitation)'
    );
    return 1.0;
  }

  // ===========================================================================
  // Snapshot Recomputation
  // ===========================================================================

  /**
   * Recomputes a single snapshot from its cached on-chain state and current journal balances.
   * Called when the journal state changes (e.g., position deleted) and snapshots become stale.
   * No external API calls — pure local computation.
   */
  async recomputeSnapshot(snapshotId: string): Promise<void> {
    const snapshot = await this.prisma.nAVSnapshot.findUnique({
      where: { id: snapshotId },
      include: { stateCache: true },
    });
    if (!snapshot) {
      this.logger.warn({ snapshotId }, 'Snapshot not found for recomputation');
      return;
    }

    // Get current set of tracked positions for this user
    const trackedPositions = await this.prisma.trackedPosition.findMany({
      where: { userId: snapshot.userId },
      select: { positionRef: true },
    });
    const trackedRefs = new Set(trackedPositions.map((tp) => tp.positionRef));

    // Reporting currency setup
    const user = await this.prisma.user.findUnique({
      where: { id: snapshot.userId },
      select: { reportingCurrency: true },
    });
    const reportingCurrency = user?.reportingCurrency ?? 'USD';
    const reportingCurrencyUsdPrice = reportingCurrency === 'USD'
      ? 1.0
      : this.getReportingCurrencyUsdPrice(reportingCurrency);

    let totalAssets = 0n;
    let activePositionCount = 0;
    const positionBreakdown: PositionBreakdownItem[] = [];

    for (const cache of snapshot.stateCache) {
      const positionStates = cache.positionStates as unknown as CachedPositionState[];
      const quoteTokenPrices = cache.quoteTokenPrices as Record<string, number>;

      for (const ps of positionStates) {
        // Skip positions that are no longer tracked
        if (!trackedRefs.has(ps.positionRef)) continue;

        activePositionCount++;

        const sqrtPriceX96 = BigInt(ps.sqrtPriceX96);
        const liquidity = BigInt(ps.liquidity);

        const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
          liquidity,
          sqrtPriceX96,
          ps.tickLower,
          ps.tickUpper,
          false
        );

        const currentValue = calculateTokenValueInQuote(
          token0Amount,
          token1Amount,
          sqrtPriceX96,
          ps.isToken0Quote,
          ps.token0Decimals,
          ps.token1Decimals
        );

        const tokensOwed0 = BigInt(ps.tokensOwed0);
        const tokensOwed1 = BigInt(ps.tokensOwed1);
        const uncollectedPrincipal0 = BigInt(ps.uncollectedPrincipal0);
        const uncollectedPrincipal1 = BigInt(ps.uncollectedPrincipal1);
        const pureFee0 = tokensOwed0 - uncollectedPrincipal0;
        const pureFee1 = tokensOwed1 - uncollectedPrincipal1;

        const unClaimedFees = calculateTokenValueInQuote(
          pureFee0,
          pureFee1,
          sqrtPriceX96,
          ps.isToken0Quote,
          ps.token0Decimals,
          ps.token1Decimals
        );

        const quoteTokenUsdPrice = ps.quoteTokenCoingeckoId
          ? (quoteTokenPrices[ps.quoteTokenCoingeckoId] ?? 1.0)
          : 1.0;
        const quoteTokenDecimals = ps.isToken0Quote ? ps.token0Decimals : ps.token1Decimals;

        const valueConversion = convertToReportingCurrency(
          currentValue.toString(),
          quoteTokenUsdPrice,
          reportingCurrencyUsdPrice,
          quoteTokenDecimals
        );

        const costBasis = BigInt(ps.currentCostBasis);
        const unrealizedPnl = currentValue - costBasis;

        const costConversion = convertToReportingCurrency(
          ps.currentCostBasis,
          quoteTokenUsdPrice,
          reportingCurrencyUsdPrice,
          quoteTokenDecimals
        );

        const unrealizedConversion = convertToReportingCurrency(
          absBigint(unrealizedPnl).toString(),
          quoteTokenUsdPrice,
          reportingCurrencyUsdPrice,
          quoteTokenDecimals
        );

        const feesConversion = convertToReportingCurrency(
          unClaimedFees.toString(),
          quoteTokenUsdPrice,
          reportingCurrencyUsdPrice,
          quoteTokenDecimals
        );

        totalAssets += BigInt(valueConversion.amountReporting);

        const unrealizedReporting = unrealizedPnl < 0n
          ? `-${unrealizedConversion.amountReporting}`
          : unrealizedConversion.amountReporting;

        positionBreakdown.push({
          positionRef: ps.positionRef,
          instrumentRef: ps.positionRef,
          poolSymbol: ps.poolSymbol,
          currentValueReporting: valueConversion.amountReporting,
          costBasisReporting: costConversion.amountReporting,
          unrealizedPnlReporting: unrealizedReporting,
          accruedFeesReporting: feesConversion.amountReporting,
        });
      }
    }

    // User-scoped journal balances as of the snapshot date (after deletions)
    const accountBalances = await this.getUserAccountBalancesForUser(snapshot.userId, snapshot.snapshotDate);
    const newHash = await this.computeJournalHash(snapshot.userId);

    await this.prisma.nAVSnapshot.update({
      where: { id: snapshotId },
      data: {
        journalHash: newHash,
        totalAssets: totalAssets.toString(),
        netAssetValue: totalAssets.toString(),
        depositedLiquidityAtCost: accountBalances.depositedLiquidity.toString(),
        markToMarketAdjustment: accountBalances.markToMarket.toString(),
        unclaimedFees: accountBalances.unclaimedFeesAsset.toString(),
        contributedCapital: accountBalances.contributedCapital.toString(),
        capitalReturned: accountBalances.capitalReturned.toString(),
        retainedRealizedWithdrawals: (accountBalances.realizedGains + accountBalances.realizedLosses).toString(),
        retainedRealizedFees: accountBalances.feeIncome.toString(),
        retainedUnrealizedPrice: (accountBalances.unrealizedGains + accountBalances.unrealizedLosses).toString(),
        retainedUnrealizedFees: accountBalances.accruedFeeIncome.toString(),
        activePositionCount: activePositionCount,
        positionBreakdown: positionBreakdown as unknown as object[],
      },
    });

    this.logger.info(
      { snapshotId, userId: snapshot.userId, activePositionCount },
      'Recomputed snapshot from cached state'
    );
  }

  /**
   * Finds and recomputes all stale snapshots for a user.
   * A snapshot is stale when its journalHash differs from the current hash.
   */
  async recomputeStaleSnapshots(userId: string): Promise<number> {
    const currentHash = await this.computeJournalHash(userId);

    const staleSnapshots = await this.prisma.nAVSnapshot.findMany({
      where: {
        userId,
        journalHash: { not: currentHash },
      },
      select: { id: true },
    });

    if (staleSnapshots.length === 0) return 0;

    this.logger.info(
      { userId, staleCount: staleSnapshots.length },
      'Recomputing stale snapshots'
    );

    for (const snapshot of staleSnapshots) {
      await this.recomputeSnapshot(snapshot.id);
    }

    return staleSnapshots.length;
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
        journalHash: input.journalHash,
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
        journalHash: input.journalHash,
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
        snapshotDate: { lt: date },
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

export function getMidnightUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}
