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
  tickToSqrtRatioX96,
  priceToTick,
  UniswapV3Pool,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
} from "@midcurve/shared";
import type { PoolJSON } from "@midcurve/shared";
import type { SwapConfig, SerializedCloseOrder } from "@midcurve/api-shared";
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

  // PnL Including Fees = realizedPnL + unrealizedPnL + unclaimedFees
  // Note: realizedPnL already includes collectedFees (fees are added to pnlAfter in the ledger)
  const pnlIncludingFees =
    realizedPnL + unrealizedPnL + unclaimedFeesAtTick;

  // PnL Excluding Fees = capital gains only (subtract fee portion from realizedPnL)
  const pnlExcludingFees = realizedPnL - collectedFees + unrealizedPnL;

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
 * Extract SL/TP trigger prices and swap configs from active close orders.
 * Shared logic used by both position states and mini PnL curve.
 */
export function extractCloseOrderData(
  activeCloseOrders: SerializedCloseOrder[],
  isToken0Quote: boolean,
  token0Decimals: number,
  token1Decimals: number,
  quoteDecimals: number,
): {
  stopLossPrice: bigint | null;
  takeProfitPrice: bigint | null;
  slSwapConfig: SwapConfig | null;
  tpSwapConfig: SwapConfig | null;
} {
  let stopLossPrice: bigint | null = null;
  let takeProfitPrice: bigint | null = null;
  let slSwapConfig: SwapConfig | null = null;
  let tpSwapConfig: SwapConfig | null = null;

  const isToken0Base = !isToken0Quote;
  const slMode = isToken0Base ? 'LOWER' : 'UPPER';
  const tpMode = isToken0Base ? 'UPPER' : 'LOWER';

  for (const order of activeCloseOrders) {
    if (!order.triggerMode || order.triggerTick == null) continue;

    const sqrtPriceX96 = BigInt(tickToSqrtRatioX96(order.triggerTick).toString());
    const Q96 = 2n ** 96n;
    const Q192 = Q96 * Q96;
    const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;

    const hasSwap = order.swapDirection !== null;
    const swapCfg: SwapConfig | null = hasSwap ? {
      enabled: true,
      direction: order.swapDirection!,
      slippageBps: order.swapSlippageBps ?? 100,
    } : null;

    if (order.triggerMode === slMode) {
      if (isToken0Base) {
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          stopLossPrice = (rawPriceNum * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteDecimals)) / Q192;
        } else {
          stopLossPrice = (rawPriceNum * 10n ** BigInt(quoteDecimals)) / (Q192 * 10n ** BigInt(-decimalDiff));
        }
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          stopLossPrice = (Q192 * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteDecimals)) / rawPriceNum;
        } else {
          stopLossPrice = (Q192 * 10n ** BigInt(quoteDecimals)) / (rawPriceNum * 10n ** BigInt(-decimalDiff));
        }
      }
      if (swapCfg) slSwapConfig = swapCfg;
    }

    if (order.triggerMode === tpMode) {
      if (isToken0Base) {
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          takeProfitPrice = (rawPriceNum * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteDecimals)) / Q192;
        } else {
          takeProfitPrice = (rawPriceNum * 10n ** BigInt(quoteDecimals)) / (Q192 * 10n ** BigInt(-decimalDiff));
        }
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          takeProfitPrice = (Q192 * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteDecimals)) / rawPriceNum;
        } else {
          takeProfitPrice = (Q192 * 10n ** BigInt(quoteDecimals)) / (rawPriceNum * 10n ** BigInt(-decimalDiff));
        }
      }
      if (swapCfg) tpSwapConfig = swapCfg;
    }
  }

  return { stopLossPrice, takeProfitPrice, slSwapConfig, tpSwapConfig };
}

/**
 * Calculate position states for lower range, current, and upper range.
 * When activeCloseOrders are provided, lower/upper range states account for
 * SL/TP triggers (matching the mini PnL curve behavior).
 *
 * @param position - Position data
 * @param pnlBreakdown - PnL breakdown data (optional)
 * @param activeCloseOrders - Active close orders for SL/TP trigger awareness
 * @returns Object with three position states
 */
export function calculatePositionStates(
  position: BasicPosition,
  pnlBreakdown: PnlBreakdown | null | undefined,
  activeCloseOrders?: SerializedCloseOrder[]
): PositionStates {
  const currentTick = position.pool.state.currentTick;

  // When isToken0Quote = true, tick-to-price relationship is inverted:
  // - tickLower gives HIGHER price (more quote per base)
  // - tickUpper gives LOWER price (fewer quote per base)
  // So we swap which tick represents "lower range" vs "upper range"
  const lowerRangeTick = position.isToken0Quote
    ? position.config.tickUpper
    : position.config.tickLower;
  const upperRangeTick = position.isToken0Quote
    ? position.config.tickLower
    : position.config.tickUpper;

  // Current state is always raw (triggers haven't fired at current price)
  const current = calculatePositionStateAtTick(position, pnlBreakdown, currentTick);

  // Without close orders, use raw calculations for all states
  if (!activeCloseOrders?.length || !pnlBreakdown) {
    return {
      lowerRange: calculatePositionStateAtTick(position, pnlBreakdown, lowerRangeTick),
      current,
      upperRange: calculatePositionStateAtTick(position, pnlBreakdown, upperRangeTick),
    };
  }

  // Extract SL/TP data from active close orders
  const closeOrderData = extractCloseOrderData(
    activeCloseOrders,
    position.isToken0Quote,
    position.pool.token0.decimals,
    position.pool.token1.decimals,
    (position.isToken0Quote ? position.pool.token0 : position.pool.token1).decimals,
  );

  // If no triggers configured, use raw calculations
  if (!closeOrderData.stopLossPrice && !closeOrderData.takeProfitPrice) {
    return {
      lowerRange: calculatePositionStateAtTick(position, pnlBreakdown, lowerRangeTick),
      current,
      upperRange: calculatePositionStateAtTick(position, pnlBreakdown, upperRangeTick),
    };
  }

  // Build simulation overlay for trigger-aware calculations
  const baseToken = position.isToken0Quote ? position.pool.token1 : position.pool.token0;
  const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  const pool = UniswapV3Pool.fromJSON(position.pool as unknown as PoolJSON);
  const costBasis = BigInt(pnlBreakdown.currentCostBasis);
  const liquidity = BigInt(position.state.liquidity);

  const basePosition = UniswapV3Position.forSimulation({
    pool,
    isToken0Quote: position.isToken0Quote,
    tickLower: position.config.tickLower,
    tickUpper: position.config.tickUpper,
    liquidity,
    costBasis,
  });

  const simulationOverlay = new CloseOrderSimulationOverlay({
    underlyingPosition: basePosition,
    stopLossPrice: closeOrderData.stopLossPrice,
    takeProfitPrice: closeOrderData.takeProfitPrice,
    stopLossSwapConfig: closeOrderData.slSwapConfig,
    takeProfitSwapConfig: closeOrderData.tpSwapConfig,
  });

  // Calculate lower range price and check if SL clips it
  const lowerRangePrice = tickToPrice(
    lowerRangeTick,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    Number(baseToken.decimals)
  );

  // Calculate upper range price and check if TP clips it
  const upperRangePrice = tickToPrice(
    upperRangeTick,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    Number(baseToken.decimals)
  );

  const realizedPnL = BigInt(pnlBreakdown.realizedPnL);
  const collectedFees = BigInt(pnlBreakdown.collectedFees);

  // Lower range: if SL trigger price is above the lower range boundary,
  // the trigger fires before reaching the range boundary
  let lowerRange: PositionState;
  if (closeOrderData.stopLossPrice && closeOrderData.stopLossPrice > lowerRangePrice) {
    const simResult = simulationOverlay.simulatePnLAtPrice(closeOrderData.stopLossPrice);
    lowerRange = {
      baseTokenAmount: simResult.baseTokenAmount ?? 0n,
      quoteTokenAmount: simResult.quoteTokenAmount ?? 0n,
      poolPrice: closeOrderData.stopLossPrice,
      positionValue: simResult.positionValue,
      pnlIncludingFees: simResult.pnlValue,
      pnlExcludingFees: realizedPnL - collectedFees + (simResult.positionValue - costBasis),
    };
  } else {
    lowerRange = calculatePositionStateAtTick(position, pnlBreakdown, lowerRangeTick);
  }

  // Upper range: if TP trigger price is below the upper range boundary,
  // the trigger fires before reaching the range boundary
  let upperRange: PositionState;
  if (closeOrderData.takeProfitPrice && closeOrderData.takeProfitPrice < upperRangePrice) {
    const simResult = simulationOverlay.simulatePnLAtPrice(closeOrderData.takeProfitPrice);
    upperRange = {
      baseTokenAmount: simResult.baseTokenAmount ?? 0n,
      quoteTokenAmount: simResult.quoteTokenAmount ?? 0n,
      poolPrice: closeOrderData.takeProfitPrice,
      positionValue: simResult.positionValue,
      pnlIncludingFees: simResult.pnlValue,
      pnlExcludingFees: realizedPnL - collectedFees + (simResult.positionValue - costBasis),
    };
  } else {
    upperRange = calculatePositionStateAtTick(position, pnlBreakdown, upperRangeTick);
  }

  return { lowerRange, current, upperRange };
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
  const unclaimedFees = BigInt(pnlBreakdown.unclaimedFees);

  // Note: realizedPnL already includes collectedFees
  const targetValue =
    currentCostBasis - realizedPnL - unclaimedFees;

  // If target value is negative or zero, position is already profitable
  if (targetValue <= 0n) {
    return null;
  }

  // Validate pool is not at extreme tick bounds
  // At MIN_TICK or MAX_TICK, price calculations become unreliable
  const currentTick = position.pool.state.currentTick;
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;

  if (currentTick <= MIN_TICK || currentTick >= MAX_TICK) {
    console.warn(
      "calculateBreakEvenPrice: Pool at extreme tick, cannot calculate break-even"
    );
    return null;
  }

  // Binary search for break-even price
  // Search range: from very low to very high price
  const currentPrice = tickToPrice(
    currentTick,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    Number(baseToken.decimals)
  );

  // Validate currentPrice is usable for binary search
  // Need at least 10 to divide by 10 and get non-zero result
  if (currentPrice < 10n) {
    console.warn(
      "calculateBreakEvenPrice: Current price too low for break-even calculation"
    );
    return null;
  }

  let lowPrice = currentPrice / 10n; // Start search at 10% of current price
  let highPrice = currentPrice * 10n; // End search at 1000% of current price

  const tolerance = BigInt(10 ** (Number(quoteToken.decimals) - 4)); // Small tolerance
  const maxIterations = 50;
  const baseIsToken0 = !position.isToken0Quote;
  const liquidity = BigInt(position.state.liquidity);

  for (let i = 0; i < maxIterations; i++) {
    const midPrice = (lowPrice + highPrice) / 2n;

    // Validate midPrice is valid before converting to tick
    if (midPrice <= 0n) {
      console.warn(
        "calculateBreakEvenPrice: Binary search reached invalid price"
      );
      break;
    }

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
