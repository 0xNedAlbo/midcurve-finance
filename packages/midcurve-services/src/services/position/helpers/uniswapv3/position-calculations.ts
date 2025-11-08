/**
 * UniswapV3 Position Calculations Helper
 *
 * Extracted calculation functions for Uniswap V3 position financial metrics.
 * These functions are stateless and can be tested independently.
 */

import type { PrismaClient } from "@prisma/client";
import type { UniswapV3Position, UniswapV3Pool } from "@midcurve/shared";
import type { Address } from "viem";
import type { Logger } from "pino";
import {
  computeFeeGrowthInside,
  calculateIncrementalFees,
  tickToPrice,
  calculatePositionValue,
} from "@midcurve/shared";
import { calculateTokenValueInQuote } from "../../../../utils/uniswapv3/ledger-calculations.js";
import { uniswapV3PoolAbi } from "../../../../utils/uniswapv3/pool-abi.js";
import type { EvmConfig } from "../../../../config/evm.js";
import type { UniswapV3PositionLedgerService } from "../../../position-ledger/uniswapv3-position-ledger-service.js";

/**
 * Ledger summary data extracted from position events
 */
export interface LedgerSummary {
  /** Current cost basis (cumulative capital deployed) */
  costBasis: bigint;
  /** Realized PnL (cumulative gains/losses from DECREASE events) */
  realizedPnl: bigint;
  /** Total collected fees (sum of all COLLECT event rewards) */
  collectedFees: bigint;
  /** Timestamp of last fee collection */
  lastFeesCollectedAt: Date;
}

/**
 * Get ledger summary for a position
 *
 * Fetches the latest ledger event and extracts financial summary data.
 *
 * @param positionId - Position database ID
 * @param ledgerService - Ledger service instance for fetching events
 * @param logger - Logger instance for warnings
 * @returns Summary object with cost basis, PnL, and fee data
 */
export async function getLedgerSummary(
  positionId: string,
  ledgerService: UniswapV3PositionLedgerService,
  logger: Logger
): Promise<LedgerSummary> {
  try {
    // Fetch all ledger events (sorted descending by timestamp)
    const events = await ledgerService.findAllItems(positionId);

    if (events.length === 0) {
      // No events yet - position just created
      return {
        costBasis: 0n,
        realizedPnl: 0n,
        collectedFees: 0n,
        lastFeesCollectedAt: new Date(0), // Epoch time - signals no collections yet
      };
    }

    // Latest event is first (descending order) - safe to use ! since we checked length
    const latestEvent = events[0]!;

    // Sum all COLLECT event rewards for collected fees
    let collectedFees = 0n;
    let lastFeesCollectedAt: Date | null = null;

    for (const event of events) {
      if (event.eventType === "COLLECT" && event.rewards.length > 0) {
        // Sum up all reward values (already in quote token)
        for (const reward of event.rewards) {
          collectedFees += reward.tokenValue;
        }
        // Track most recent collection timestamp
        if (
          !lastFeesCollectedAt ||
          event.timestamp > lastFeesCollectedAt
        ) {
          lastFeesCollectedAt = event.timestamp;
        }
      }
    }

    return {
      costBasis: latestEvent.costBasisAfter,
      realizedPnl: latestEvent.pnlAfter,
      collectedFees,
      lastFeesCollectedAt: lastFeesCollectedAt ?? new Date(0), // Epoch time - signals no collections yet
    };
  } catch (error) {
    logger.warn(
      { error, positionId },
      "Failed to get ledger summary, using defaults"
    );
    return {
      costBasis: 0n,
      realizedPnl: 0n,
      collectedFees: 0n,
      lastFeesCollectedAt: new Date(0), // Epoch time - signals no collections yet
    };
  }
}

/**
 * Uncollected principal amounts from ledger
 */
export interface UncollectedPrincipal {
  /** Uncollected principal in token0 (from DECREASE events, not yet COLLECTed) */
  uncollectedPrincipal0: bigint;
  /** Uncollected principal in token1 (from DECREASE events, not yet COLLECTed) */
  uncollectedPrincipal1: bigint;
}

/**
 * Get uncollected principal from the latest ledger event
 *
 * When a position's liquidity is decreased, the withdrawn token amounts are added to
 * `tokensOwed*` in the NFPM contract but remain uncollected until `collect()` is called.
 * The ledger tracks these amounts as `uncollectedPrincipal0/1After` in event configs.
 *
 * This function reads the latest ledger event to get the current uncollected principal amounts.
 * These amounts are subtracted from `tokensOwed*` to calculate pure fees (not mixed with principal).
 *
 * @param positionId - Position database ID
 * @param ledgerService - Ledger service instance for fetching events
 * @param logger - Logger instance for warnings
 * @returns Uncollected principal amounts in token0 and token1
 */
export async function getUncollectedPrincipalFromLedger(
  positionId: string,
  ledgerService: UniswapV3PositionLedgerService,
  logger: Logger
): Promise<UncollectedPrincipal> {
  try {
    const events = await ledgerService.findAllItems(positionId);

    if (events.length === 0) {
      // No events yet - no uncollected principal
      return {
        uncollectedPrincipal0: 0n,
        uncollectedPrincipal1: 0n,
      };
    }

    // Latest event is first (descending order by timestamp)
    const latestEvent = events[0]!;

    // Extract uncollected principal from event config
    const config = latestEvent.config as {
      uncollectedPrincipal0After: bigint;
      uncollectedPrincipal1After: bigint;
    };

    return {
      uncollectedPrincipal0: config.uncollectedPrincipal0After,
      uncollectedPrincipal1: config.uncollectedPrincipal1After,
    };
  } catch (error) {
    logger.warn(
      { error, positionId },
      "Failed to get uncollected principal from ledger, using 0"
    );
    return {
      uncollectedPrincipal0: 0n,
      uncollectedPrincipal1: 0n,
    };
  }
}

/**
 * Result of unclaimed fees calculation
 */
export interface UnclaimedFeesResult {
  /** Total unclaimed fees in quote token value */
  unclaimedFeesValue: bigint;
  /** Unclaimed fees in token0 (incremental + checkpointed) */
  unclaimedFees0: bigint;
  /** Unclaimed fees in token1 (incremental + checkpointed) */
  unclaimedFees1: bigint;
}

/**
 * Calculate unclaimed fees for a position
 *
 * Implements the complete fee calculation algorithm:
 * 1. Calculate incremental fees (fees earned since last checkpoint via feeGrowthInside)
 * 2. Read tokensOwed* from position state (checkpointed fees + uncollected principal)
 * 3. Get uncollected principal from ledger events (withdrawn liquidity not yet collected)
 * 4. Separate pure fees from tokensOwed by subtracting uncollected principal
 * 5. Return total claimable fees = incremental + checkpointed (pure fees only)
 *
 * Why this is necessary:
 * - `tokensOwed*` in NFPM contract contains BOTH fees AND withdrawn principal
 * - When liquidity is decreased, token amounts are added to `tokensOwed*`
 * - Those amounts remain in `tokensOwed*` until `collect()` is called
 * - We must separate pure fees from principal to show accurate unclaimed fees
 *
 * @param position - Position object with config and state (includes tokensOwed*)
 * @param pool - Pool object with current state
 * @param evmConfig - EVM config for RPC access
 * @param ledgerService - Ledger service for reading uncollected principal
 * @param logger - Logger instance for warnings
 * @returns Object containing quote-denominated total and individual token amounts
 */
export async function calculateUnclaimedFees(
  position: UniswapV3Position,
  pool: UniswapV3Pool,
  evmConfig: EvmConfig,
  ledgerService: UniswapV3PositionLedgerService,
  logger: Logger
): Promise<UnclaimedFeesResult> {
  try {
    const { chainId, poolAddress, tickLower, tickUpper } =
      position.config;
    const {
      liquidity,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
    } = position.state;

    // If no liquidity, no fees
    if (liquidity === 0n) {
      return {
        unclaimedFeesValue: 0n,
        unclaimedFees0: 0n,
        unclaimedFees1: 0n,
      };
    }

    const client = evmConfig.getPublicClient(chainId);

    // Read pool global fee growth and tick data
    const [
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
      tickDataLower,
      tickDataUpper,
    ] = await Promise.all([
      client.readContract({
        address: poolAddress as Address,
        abi: uniswapV3PoolAbi,
        functionName: "feeGrowthGlobal0X128",
      }) as Promise<bigint>,
      client.readContract({
        address: poolAddress as Address,
        abi: uniswapV3PoolAbi,
        functionName: "feeGrowthGlobal1X128",
      }) as Promise<bigint>,
      client.readContract({
        address: poolAddress as Address,
        abi: uniswapV3PoolAbi,
        functionName: "ticks",
        args: [tickLower],
      }) as Promise<
        readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          number,
          boolean
        ]
      >,
      client.readContract({
        address: poolAddress as Address,
        abi: uniswapV3PoolAbi,
        functionName: "ticks",
        args: [tickUpper],
      }) as Promise<
        readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          number,
          boolean
        ]
      >,
    ]);

    // Extract feeGrowthOutside from tick data
    const feeGrowthOutsideLower0X128 = tickDataLower[2];
    const feeGrowthOutsideLower1X128 = tickDataLower[3];
    const feeGrowthOutsideUpper0X128 = tickDataUpper[2];
    const feeGrowthOutsideUpper1X128 = tickDataUpper[3];

    // Calculate fee growth inside using pool's current tick
    const feeGrowthInside = computeFeeGrowthInside(
      pool.state.currentTick,
      tickLower,
      tickUpper,
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
      feeGrowthOutsideLower0X128,
      feeGrowthOutsideLower1X128,
      feeGrowthOutsideUpper0X128,
      feeGrowthOutsideUpper1X128
    );

    // STEP 1: Calculate incremental fees (fees earned since last checkpoint)
    const incremental0 = calculateIncrementalFees(
      feeGrowthInside.inside0,
      feeGrowthInside0LastX128,
      liquidity
    );
    const incremental1 = calculateIncrementalFees(
      feeGrowthInside.inside1,
      feeGrowthInside1LastX128,
      liquidity
    );

    // STEP 2: Get tokensOwed from position state (checkpointed fees + uncollected principal)
    const tokensOwed0 = position.state.tokensOwed0;
    const tokensOwed1 = position.state.tokensOwed1;

    // STEP 3: Get uncollected principal from latest ledger event
    const uncollectedPrincipal = await getUncollectedPrincipalFromLedger(
      position.id,
      ledgerService,
      logger
    );

    // STEP 4: Separate pure checkpointed fees from tokensOwed by subtracting principal
    // If tokensOwed < uncollectedPrincipal, all of tokensOwed is principal (no fees checkpointed)
    const pureCheckpointedFees0 =
      tokensOwed0 > uncollectedPrincipal.uncollectedPrincipal0
        ? tokensOwed0 - uncollectedPrincipal.uncollectedPrincipal0
        : 0n;

    const pureCheckpointedFees1 =
      tokensOwed1 > uncollectedPrincipal.uncollectedPrincipal1
        ? tokensOwed1 - uncollectedPrincipal.uncollectedPrincipal1
        : 0n;

    // STEP 5: Total claimable fees = checkpointed + incremental
    const totalClaimable0 = pureCheckpointedFees0 + incremental0;
    const totalClaimable1 = pureCheckpointedFees1 + incremental1;

    // Convert to quote token value using the correct utility function
    // This handles precision properly by scaling before dividing
    const unclaimedFeesValue = calculateTokenValueInQuote(
      totalClaimable0,
      totalClaimable1,
      pool.state.sqrtPriceX96,
      position.isToken0Quote,
      pool.token0.decimals,
      pool.token1.decimals
    );

    logger.debug(
      {
        positionId: position.id,
        incremental0: incremental0.toString(),
        incremental1: incremental1.toString(),
        tokensOwed0: tokensOwed0.toString(),
        tokensOwed1: tokensOwed1.toString(),
        uncollectedPrincipal0: uncollectedPrincipal.uncollectedPrincipal0.toString(),
        uncollectedPrincipal1: uncollectedPrincipal.uncollectedPrincipal1.toString(),
        pureCheckpointedFees0: pureCheckpointedFees0.toString(),
        pureCheckpointedFees1: pureCheckpointedFees1.toString(),
        totalClaimable0: totalClaimable0.toString(),
        totalClaimable1: totalClaimable1.toString(),
        unclaimedFeesValue: unclaimedFeesValue.toString(),
      },
      "Unclaimed fees calculation breakdown"
    );

    return {
      unclaimedFeesValue,
      unclaimedFees0: totalClaimable0,
      unclaimedFees1: totalClaimable1,
    };
  } catch (error) {
    logger.warn(
      { error, positionId: position.id },
      "Failed to calculate unclaimed fees, using 0"
    );
    return {
      unclaimedFeesValue: 0n,
      unclaimedFees0: 0n,
      unclaimedFees1: 0n,
    };
  }
}

/**
 * Calculate current position value
 *
 * Uses liquidity utility to calculate token amounts and convert to quote value.
 *
 * @param position - Position object with config and state
 * @param pool - Pool object with current state
 * @returns Current position value in quote token units
 */
export function calculateCurrentPositionValue(
  position: UniswapV3Position,
  pool: UniswapV3Pool
): bigint {
  const { tickLower, tickUpper } = position.config;
  const { liquidity } = position.state;
  const { sqrtPriceX96 } = pool.state;

  if (liquidity === 0n) {
    return 0n;
  }

  // Determine token roles
  const baseIsToken0 = !position.isToken0Quote;

  // Calculate position value using utility function
  // Converts all token amounts to quote token value using sqrtPriceX96
  const positionValue = calculatePositionValue(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper,
    baseIsToken0
  );

  return positionValue;
}

/**
 * Calculate price range bounds
 *
 * Converts tick bounds to prices in quote token.
 *
 * @param position - Position object with config
 * @param pool - Pool object with token data
 * @returns Price range lower and upper bounds in quote token
 */
export function calculatePriceRange(
  position: UniswapV3Position,
  pool: UniswapV3Pool
): { priceRangeLower: bigint; priceRangeUpper: bigint } {
  const { tickLower, tickUpper } = position.config;

  // Determine token addresses and decimals based on token roles
  const baseToken = position.isToken0Quote ? pool.token1 : pool.token0;
  const quoteToken = position.isToken0Quote ? pool.token0 : pool.token1;
  const baseTokenAddress = baseToken.config.address;
  const quoteTokenAddress = quoteToken.config.address;
  const baseTokenDecimals = baseToken.decimals;

  // Convert ticks to prices (quote per base)
  const priceRangeLower = tickToPrice(
    tickLower,
    baseTokenAddress,
    quoteTokenAddress,
    baseTokenDecimals
  );

  const priceRangeUpper = tickToPrice(
    tickUpper,
    baseTokenAddress,
    quoteTokenAddress,
    baseTokenDecimals
  );

  return { priceRangeLower, priceRangeUpper };
}

/**
 * Get current liquidity from the most recent ledger event
 *
 * The ledger is the source of truth for liquidity as it tracks all INCREASE/DECREASE events.
 * This method queries the last ledger event's `liquidityAfter` field to determine the
 * current liquidity state without making on-chain calls.
 *
 * @param positionId - Position ID
 * @param prisma - Prisma client for database access
 * @param logger - Logger instance for debug logs
 * @returns Current liquidity (0n if no events exist or position is closed)
 */
export async function getCurrentLiquidityFromLedger(
  positionId: string,
  prisma: PrismaClient,
  logger: Logger
): Promise<bigint> {
  const lastEvent = await prisma.positionLedgerEvent.findFirst({
    where: { positionId },
    orderBy: { timestamp: "desc" },
    select: { config: true },
  });

  if (!lastEvent) {
    // No events yet, position has no liquidity
    logger.debug(
      { positionId },
      "No ledger events found, returning liquidity = 0"
    );
    return 0n;
  }

  // Parse the config to get liquidityAfter
  const config = lastEvent.config as { liquidityAfter?: string };
  const liquidityAfter = config.liquidityAfter
    ? BigInt(config.liquidityAfter)
    : 0n;

  logger.debug(
    { positionId, liquidityAfter: liquidityAfter.toString() },
    "Retrieved liquidity from last ledger event"
  );

  return liquidityAfter;
}
