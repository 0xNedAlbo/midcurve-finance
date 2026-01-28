/**
 * Uniswap V3 Fee Calculation Utilities
 *
 * Implements the fee growth calculation logic from the Uniswap V3 whitepaper
 * for computing unclaimed fees in positions.
 */

import { Q128 } from './constants.js';

/**
 * Safe difference calculation for uint256-like BigInt values with overflow handling.
 *
 * Implements Solidity's uint256 underflow behavior (modular arithmetic at 2^256).
 * When a < b in uint256, subtraction wraps around: a - b + 2^256
 *
 * This is crucial for fee growth calculations where feeGrowthInsideLast can be
 * larger than feeGrowthGlobal due to uint256 overflow in the Uniswap V3 contracts.
 *
 * Example: If feeGrowthInsideLast = 2^256 - 100 and feeGrowthGlobal = 50,
 * the actual growth is 150, not 0.
 *
 * @param a - First value (e.g., feeGrowthGlobal)
 * @param b - Second value (e.g., feeGrowthInsideLast)
 * @returns Difference with uint256 overflow semantics
 */
export function safeDiff(a: bigint, b: bigint): bigint {
  const MAX_UINT256 = (1n << 256n) - 1n;
  return (a - b + MAX_UINT256 + 1n) & MAX_UINT256;
}

/**
 * Fee growth inside data structure
 */
export interface FeeGrowthInside {
  inside0: bigint;
  inside1: bigint;
}

/**
 * Tick fee growth data (from pool.ticks(tick))
 *
 * Contains the fee growth outside values for a single tick.
 * These values are updated when the tick is crossed during swaps.
 */
export interface TickFeeGrowth {
  /** Fee growth outside this tick for token0 */
  feeGrowthOutside0X128: bigint;
  /** Fee growth outside this tick for token1 */
  feeGrowthOutside1X128: bigint;
}

/**
 * Unclaimed fees breakdown for a position
 */
export interface UnclaimedFees {
  /** Incremental fees earned since last checkpoint (token0) */
  incremental0: bigint;
  /** Incremental fees earned since last checkpoint (token1) */
  incremental1: bigint;
  /** Fees already checkpointed in NFPM (token0) */
  checkpointed0: bigint;
  /** Fees already checkpointed in NFPM (token1) */
  checkpointed1: bigint;
  /** Total claimable fees right now (token0) */
  totalClaimable0: bigint;
  /** Total claimable fees right now (token1) */
  totalClaimable1: bigint;
}

/**
 * Unclaimed fees with additional metadata for service layer
 */
export interface UnclaimedFeesWithMetadata {
  /** Core fee data */
  fees: UnclaimedFees;
  /** Base token amount (determined by token0IsQuote flag) */
  baseTokenAmount: bigint;
  /** Quote token amount (determined by token0IsQuote flag) */
  quoteTokenAmount: bigint;
  /** Value in quote token units (baseTokenAmount * current pool price) */
  valueInQuoteToken: string; // BigInt as string following our storage pattern
}

/**
 * Computes feeGrowthInside for both tokens according to Uniswap V3 whitepaper logic.
 *
 * The fee growth inside a tick range is calculated as:
 * feeGrowthInside = feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove
 *
 * Where:
 * - feeGrowthBelow: Fee growth accumulated below the lower tick
 * - feeGrowthAbove: Fee growth accumulated above the upper tick
 *
 * The logic handles the case where the current tick is above, below, or within
 * the position's tick range by using the feeGrowthOutside values appropriately.
 *
 * @param tickCurrent - Current pool tick
 * @param tickLower - Position's lower tick bound
 * @param tickUpper - Position's upper tick bound
 * @param feeGrowthGlobal0 - Global fee growth for token0
 * @param feeGrowthGlobal1 - Global fee growth for token1
 * @param feeGrowthOutsideLower0 - Fee growth outside lower tick for token0
 * @param feeGrowthOutsideLower1 - Fee growth outside lower tick for token1
 * @param feeGrowthOutsideUpper0 - Fee growth outside upper tick for token0
 * @param feeGrowthOutsideUpper1 - Fee growth outside upper tick for token1
 * @returns Object containing inside fee growth for both tokens
 */
export function computeFeeGrowthInside(
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
  feeGrowthGlobal0: bigint,
  feeGrowthGlobal1: bigint,
  feeGrowthOutsideLower0: bigint,
  feeGrowthOutsideLower1: bigint,
  feeGrowthOutsideUpper0: bigint,
  feeGrowthOutsideUpper1: bigint
): FeeGrowthInside {
  // Calculate below-range component
  // If current tick >= lower tick, fees below are already accounted in feeGrowthOutsideLower
  // Otherwise, fees below = feeGrowthGlobal - feeGrowthOutsideLower
  const below0 =
    tickCurrent >= tickLower
      ? feeGrowthOutsideLower0
      : safeDiff(feeGrowthGlobal0, feeGrowthOutsideLower0);

  const below1 =
    tickCurrent >= tickLower
      ? feeGrowthOutsideLower1
      : safeDiff(feeGrowthGlobal1, feeGrowthOutsideLower1);

  // Calculate above-range component
  // If current tick < upper tick, fees above are already accounted in feeGrowthOutsideUpper
  // Otherwise, fees above = feeGrowthGlobal - feeGrowthOutsideUpper
  const above0 =
    tickCurrent < tickUpper
      ? feeGrowthOutsideUpper0
      : safeDiff(feeGrowthGlobal0, feeGrowthOutsideUpper0);

  const above1 =
    tickCurrent < tickUpper
      ? feeGrowthOutsideUpper1
      : safeDiff(feeGrowthGlobal1, feeGrowthOutsideUpper1);

  // Fee growth inside = global fee growth - fees below range - fees above range
  const inside0 = safeDiff(safeDiff(feeGrowthGlobal0, below0), above0);
  const inside1 = safeDiff(safeDiff(feeGrowthGlobal1, below1), above1);

  return { inside0, inside1 };
}

/**
 * Calculates the incremental fees owed since the last checkpoint.
 *
 * @param feeGrowthInsideCurrent - Current fee growth inside the position range
 * @param feeGrowthInsideLast - Fee growth inside at last checkpoint (from NFPM)
 * @param liquidity - Position liquidity amount
 * @returns Incremental fees owed in token native units
 */
export function calculateIncrementalFees(
  feeGrowthInsideCurrent: bigint,
  feeGrowthInsideLast: bigint,
  liquidity: bigint
): bigint {
  // Calculate the delta in fee growth since last checkpoint
  const feeGrowthDelta = safeDiff(feeGrowthInsideCurrent, feeGrowthInsideLast);

  // Convert Q128.128 fee growth to actual token amount
  // fees = (feeGrowthDelta * liquidity) / Q128
  return (feeGrowthDelta * liquidity) / Q128;
}

/**
 * Input parameters for unclaimed fee amounts calculation
 *
 * Takes raw position state, pool state, and tick data to compute unclaimed fees.
 * The function computes feeGrowthInside internally from the provided data.
 */
export interface UnclaimedFeeAmountsInput {
  // Position state (from NFPM contract)
  /** Position liquidity */
  liquidity: bigint;
  /** Position's lower tick bound */
  tickLower: number;
  /** Position's upper tick bound */
  tickUpper: number;
  /** Fee growth inside at last checkpoint for token0 (from position state) */
  feeGrowthInside0LastX128: bigint;
  /** Fee growth inside at last checkpoint for token1 (from position state) */
  feeGrowthInside1LastX128: bigint;
  /** Tokens owed for token0 (from position state - contains fees + uncollected principal) */
  tokensOwed0: bigint;
  /** Tokens owed for token1 (from position state - contains fees + uncollected principal) */
  tokensOwed1: bigint;

  // Tick fee growth data (from position state, fetched via pool.ticks())
  /** Fee growth outside lower tick for token0 */
  tickLowerFeeGrowthOutside0X128: bigint;
  /** Fee growth outside lower tick for token1 */
  tickLowerFeeGrowthOutside1X128: bigint;
  /** Fee growth outside upper tick for token0 */
  tickUpperFeeGrowthOutside0X128: bigint;
  /** Fee growth outside upper tick for token1 */
  tickUpperFeeGrowthOutside1X128: bigint;

  // Pool state (from pool contract)
  /** Current pool tick (from slot0) */
  currentTick: number;
  /** Global fee growth for token0 */
  feeGrowthGlobal0X128: bigint;
  /** Global fee growth for token1 */
  feeGrowthGlobal1X128: bigint;

  // Ledger data (optional - defaults to 0n if not tracking principal)
  /** Uncollected principal for token0 (from ledger events) */
  uncollectedPrincipal0?: bigint;
  /** Uncollected principal for token1 (from ledger events) */
  uncollectedPrincipal1?: bigint;
}

/**
 * Result of unclaimed fee amounts calculation
 */
export interface UnclaimedFeeAmountsResult {
  /** Unclaimed fees in token0 (incremental + checkpointed) */
  unclaimedFees0: bigint;
  /** Unclaimed fees in token1 (incremental + checkpointed) */
  unclaimedFees1: bigint;
}

/**
 * Calculate unclaimed fee amounts for a position
 *
 * Pure calculation function that computes the unclaimed fees in token amounts.
 * Does NOT convert to quote token value.
 *
 * Algorithm:
 * 1. Compute feeGrowthInside from pool state and tick data
 * 2. Calculate incremental fees (fees earned since last checkpoint)
 * 3. Separate pure fees from tokensOwed by subtracting uncollected principal
 * 4. Return total = incremental + checkpointed (pure fees only)
 *
 * Why separating principal is necessary:
 * - `tokensOwed*` in NFPM contract contains BOTH fees AND withdrawn principal
 * - When liquidity is decreased, token amounts are added to `tokensOwed*`
 * - Those amounts remain in `tokensOwed*` until `collect()` is called
 * - We must separate pure fees from principal to show accurate unclaimed fees
 *
 * @param input - Calculation parameters
 * @returns Object containing unclaimed fee amounts for both tokens
 */
export function calculateUnclaimedFeeAmounts(
  input: UnclaimedFeeAmountsInput
): UnclaimedFeeAmountsResult {
  const {
    liquidity,
    tickLower,
    tickUpper,
    feeGrowthInside0LastX128,
    feeGrowthInside1LastX128,
    tokensOwed0,
    tokensOwed1,
    tickLowerFeeGrowthOutside0X128,
    tickLowerFeeGrowthOutside1X128,
    tickUpperFeeGrowthOutside0X128,
    tickUpperFeeGrowthOutside1X128,
    currentTick,
    feeGrowthGlobal0X128,
    feeGrowthGlobal1X128,
    uncollectedPrincipal0 = 0n,
    uncollectedPrincipal1 = 0n,
  } = input;

  // 1. Compute current feeGrowthInside from pool state and tick data
  const { inside0: feeGrowthInside0, inside1: feeGrowthInside1 } =
    computeFeeGrowthInside(
      currentTick,
      tickLower,
      tickUpper,
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
      tickLowerFeeGrowthOutside0X128,
      tickLowerFeeGrowthOutside1X128,
      tickUpperFeeGrowthOutside0X128,
      tickUpperFeeGrowthOutside1X128
    );

  // 2. Calculate incremental fees (fees earned since last checkpoint)
  // If no liquidity, no incremental fees (but may still have checkpointed fees)
  const incremental0 =
    liquidity > 0n
      ? calculateIncrementalFees(
          feeGrowthInside0,
          feeGrowthInside0LastX128,
          liquidity
        )
      : 0n;
  const incremental1 =
    liquidity > 0n
      ? calculateIncrementalFees(
          feeGrowthInside1,
          feeGrowthInside1LastX128,
          liquidity
        )
      : 0n;

  // 3. Separate pure checkpointed fees from tokensOwed by subtracting principal
  // If tokensOwed < uncollectedPrincipal, all of tokensOwed is principal (no fees checkpointed)
  const pureCheckpointedFees0 =
    tokensOwed0 > uncollectedPrincipal0
      ? tokensOwed0 - uncollectedPrincipal0
      : 0n;
  const pureCheckpointedFees1 =
    tokensOwed1 > uncollectedPrincipal1
      ? tokensOwed1 - uncollectedPrincipal1
      : 0n;

  // 4. Total = checkpointed + incremental
  return {
    unclaimedFees0: pureCheckpointedFees0 + incremental0,
    unclaimedFees1: pureCheckpointedFees1 + incremental1,
  };
}
