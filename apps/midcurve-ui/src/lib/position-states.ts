/**
 * Position State Calculations
 *
 * Utilities for calculating position states at different price points (lower range, current, upper range).
 * Used in position detail views to show "what if" scenarios and break-even calculations.
 */

import {
  getTokenAmountsFromLiquidity,
  calculatePositionValue,
  tickToPrice,
  priceToTick,
} from "@midcurve/shared";
import { TickMath } from "@uniswap/v3-sdk";

/**
 * Position state interface - represents position at a specific price point
 */
export interface PositionState {
  baseTokenAmount: bigint;
  quoteTokenAmount: bigint;
  poolPrice: bigint;
  positionValue: bigint;
  pnlIncludingFees: bigint;
  pnlExcludingFees: bigint;
}

/**
 * Three key position states for visualization
 */
export interface PositionStates {
  lowerRange: PositionState;
  current: PositionState;
  upperRange: PositionState;
}

/**
 * PnL breakdown from API
 */
interface PnlBreakdown {
  currentValue: string;
  currentCostBasis: string;
  realizedPnL: string;
  collectedFees: string;
  unclaimedFees: string;
}

/**
 * Minimal position interface for calculations
 */
interface BasicPosition {
  isToken0Quote: boolean;
  state: {
    liquidity: string;
  };
  config: {
    tickLower: number;
    tickUpper: number;
  };
  pool: {
    token0: {
      config: { address: string };
      decimals: number;
    };
    token1: {
      config: { address: string };
      decimals: number;
    };
    config: {
      tickSpacing: number;
    };
    state: {
      currentTick: number;
    };
  };
}

/**
 * Calculate position state at a specific tick
 * @param position - Position data
 * @param pnlBreakdown - PnL breakdown data (optional)
 * @param tick - Tick to calculate state at
 * @returns Position state at the specified tick
 */
function calculatePositionStateAtTick(
  position: BasicPosition,
  pnlBreakdown: PnlBreakdown | null | undefined,
  tick: number
): PositionState {
  const { pool } = position;
  const baseToken = position.isToken0Quote ? pool.token1 : pool.token0;
  const quoteToken = position.isToken0Quote ? pool.token0 : pool.token1;

  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  const liquidity = BigInt(position.state.liquidity);
  const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(tick).toString());

  // Calculate token amounts at this tick
  const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
    liquidity,
    sqrtPriceX96,
    position.config.tickLower,
    position.config.tickUpper
  );

  // Determine base and quote amounts
  const baseTokenAmount = position.isToken0Quote ? token1Amount : token0Amount;
  const quoteTokenAmount = position.isToken0Quote ? token0Amount : token1Amount;

  // Calculate price at this tick
  const poolPrice = tickToPrice(
    tick,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    Number(baseToken.decimals)
  );

  // Calculate position value at this tick
  const baseIsToken0 = !position.isToken0Quote;
  const positionValue = calculatePositionValue(
    liquidity,
    sqrtPriceX96,
    position.config.tickLower,
    position.config.tickUpper,
    baseIsToken0
  );

  // Get PnL components (default to 0 if no breakdown available)
  const currentCostBasis = pnlBreakdown ? BigInt(pnlBreakdown.currentCostBasis) : 0n;
  const realizedPnL = pnlBreakdown ? BigInt(pnlBreakdown.realizedPnL) : 0n;
  const collectedFees = pnlBreakdown ? BigInt(pnlBreakdown.collectedFees) : 0n;
  const unclaimedFees = pnlBreakdown ? BigInt(pnlBreakdown.unclaimedFees) : 0n;

  // Calculate PnL including and excluding fees
  // unrealizedPnL = positionValue - costBasis
  const unrealizedPnL = positionValue - currentCostBasis;

  // For current tick, use unclaimed fees; for other ticks, fees would be 0
  const unclaimedFeesAtTick =
    tick === position.pool.state.currentTick ? unclaimedFees : 0n;

  // PnL Including Fees = realizedPnL + unrealizedPnL + unclaimedFees + collectedFees
  const pnlIncludingFees =
    realizedPnL + unrealizedPnL + unclaimedFeesAtTick + collectedFees;

  // PnL Excluding Fees = realizedPnL + unrealizedPnL + collectedFees
  const pnlExcludingFees = realizedPnL + unrealizedPnL + collectedFees;

  return {
    baseTokenAmount,
    quoteTokenAmount,
    poolPrice,
    positionValue,
    pnlIncludingFees,
    pnlExcludingFees,
  };
}

/**
 * Calculate position states for lower range, current, and upper range
 * @param position - Position data
 * @param pnlBreakdown - PnL breakdown data (optional)
 * @returns Object with three position states
 */
export function calculatePositionStates(
  position: BasicPosition,
  pnlBreakdown: PnlBreakdown | null | undefined
): PositionStates {
  const currentTick = position.pool.state.currentTick;

  return {
    lowerRange: calculatePositionStateAtTick(
      position,
      pnlBreakdown,
      position.config.tickLower
    ),
    current: calculatePositionStateAtTick(position, pnlBreakdown, currentTick),
    upperRange: calculatePositionStateAtTick(
      position,
      pnlBreakdown,
      position.config.tickUpper
    ),
  };
}

/**
 * Calculate break-even price for a position
 * Break-even = price where position value equals net investment
 *
 * @param position - Position data
 * @param pnlBreakdown - PnL breakdown data
 * @returns Break-even price in quote token units, or null if not applicable
 */
export function calculateBreakEvenPrice(
  position: BasicPosition,
  pnlBreakdown: PnlBreakdown | null | undefined
): bigint | null {
  if (!pnlBreakdown) {
    return null;
  }

  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Calculate target value (net investment amount)
  const currentCostBasis = BigInt(pnlBreakdown.currentCostBasis);
  const realizedPnL = BigInt(pnlBreakdown.realizedPnL);
  const collectedFees = BigInt(pnlBreakdown.collectedFees);
  const unclaimedFees = BigInt(pnlBreakdown.unclaimedFees);

  const targetValue =
    currentCostBasis - realizedPnL - collectedFees - unclaimedFees;

  // If target value is negative or zero, position is already profitable
  if (targetValue <= 0n) {
    return null;
  }

  // Binary search for break-even price
  // Search range: from very low to very high price
  const currentPrice = tickToPrice(
    position.pool.state.currentTick,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    Number(baseToken.decimals)
  );

  let lowPrice = currentPrice / 10n; // Start search at 10% of current price
  let highPrice = currentPrice * 10n; // End search at 1000% of current price

  const tolerance = BigInt(10 ** (Number(quoteToken.decimals) - 4)); // Small tolerance
  const maxIterations = 50;
  const baseIsToken0 = !position.isToken0Quote;
  const liquidity = BigInt(position.state.liquidity);

  for (let i = 0; i < maxIterations; i++) {
    const midPrice = (lowPrice + highPrice) / 2n;

    // Convert price to tick
    const tick = priceToTick(
      midPrice,
      position.pool.config.tickSpacing,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      Number(baseToken.decimals)
    );

    // Calculate position value at this price
    const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
    const positionValue = calculatePositionValue(
      liquidity,
      sqrtPriceX96,
      position.config.tickLower,
      position.config.tickUpper,
      baseIsToken0
    );

    // Check if we're close enough to target value
    const diff =
      positionValue > targetValue
        ? positionValue - targetValue
        : targetValue - positionValue;

    if (diff <= tolerance) {
      return midPrice;
    }

    // Adjust search range
    if (positionValue < targetValue) {
      lowPrice = midPrice;
    } else {
      highPrice = midPrice;
    }

    // Prevent infinite loops with very tight ranges
    if (highPrice - lowPrice <= tolerance) {
      break;
    }
  }

  // Return best approximation
  return (lowPrice + highPrice) / 2n;
}
