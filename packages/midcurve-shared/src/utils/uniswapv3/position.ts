import { priceToTick } from "./price.js";
import { calculatePositionValue } from "./liquidity.js";
import { TickMath } from "@uniswap/v3-sdk";
import type { PnLPoint, PositionPhase } from "./types.js";

/**
 * Position calculations and analysis for Uniswap V3
 * Pure functions with simple parameters - no custom data structures
 */


/**
 * Determine position phase for PnL curve
 * @param tickCurrent Current price tick
 * @param tickLower Lower bound tick
 * @param tickUpper Upper bound tick
 * @returns Position phase
 */
export function determinePhase(
    tickCurrent: number,
    tickLower: number,
    tickUpper: number
): PositionPhase {
    if (tickCurrent < tickLower) {
        return "below";
    } else if (tickCurrent >= tickUpper) {
        return "above";
    } else {
        return "in-range";
    }
}

/**
 * Calculate PnL for a position
 * @param currentValue Current position value in quote token
 * @param costBasis Cost basis (total capital invested) in quote token
 * @returns PnL information (unrealized PnL and percentage)
 */
export function calculatePnL(
    currentValue: bigint,
    costBasis: bigint
): {
    pnl: bigint;
    pnlPercent: number;
} {
    const pnl = currentValue - costBasis;
    const pnlPercent =
        costBasis > 0n ? Number((pnl * 10000n) / costBasis) / 100 : 0;

    return { pnl, pnlPercent };
}

/**
 * Generate PnL curve data points
 * @param liquidity Position liquidity
 * @param tickLower Lower bound tick
 * @param tickUpper Upper bound tick
 * @param costBasis Cost basis for PnL calculation (baseline value). For new positions, this is the initial investment value. For existing positions, this is the current cost basis after operations.
 * @param baseTokenAddress Base token address
 * @param quoteTokenAddress Quote token address
 * @param baseTokenDecimals Base token decimals
 * @param tickSpacing Tick spacing for price calculations
 * @param priceRange Price range to analyze
 * @param numPoints Number of data points to generate
 * @returns Array of PnL points
 */
export function generatePnLCurve(
    liquidity: bigint,
    tickLower: number,
    tickUpper: number,
    costBasis: bigint,
    baseTokenAddress: string,
    quoteTokenAddress: string,
    baseTokenDecimals: number,
    tickSpacing: number,
    priceRange: { min: bigint; max: bigint },
    numPoints: number = 150
): PnLPoint[] {
    const points: PnLPoint[] = [];
    const priceStep = (priceRange.max - priceRange.min) / BigInt(numPoints);

    // Determine if base is token0
    const baseIsToken0 = BigInt(baseTokenAddress) < BigInt(quoteTokenAddress);

    for (let i = 0; i <= numPoints; i++) {
        const price = priceRange.min + BigInt(i) * priceStep;
        const tick = priceToTick(
            price,
            tickSpacing,
            baseTokenAddress,
            quoteTokenAddress,
            baseTokenDecimals
        );

        // Convert tick to sqrtPriceX96 for hypothetical curve point
        const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
        const positionValue = calculatePositionValue(
            liquidity,
            sqrtPriceX96,
            tickLower,
            tickUpper,
            baseIsToken0
        );

        const { pnl, pnlPercent } = calculatePnL(positionValue, costBasis);
        const phase = determinePhase(tick, tickLower, tickUpper);

        points.push({
            price,
            positionValue,
            pnl,
            pnlPercent,
            phase,
        });
    }

    return points;
}


/**
 * Calculate position value at a specific price
 * @param liquidity Position liquidity
 * @param tickLower Lower bound tick
 * @param tickUpper Upper bound tick
 * @param targetPrice Target price to evaluate
 * @param baseTokenAddress Base token address
 * @param quoteTokenAddress Quote token address
 * @param baseTokenDecimals Base token decimals
 * @param tickSpacing Tick spacing
 * @returns Position value at target price
 */
export function calculatePositionValueAtPrice(
    liquidity: bigint,
    tickLower: number,
    tickUpper: number,
    targetPrice: bigint,
    baseTokenAddress: string,
    quoteTokenAddress: string,
    baseTokenDecimals: number,
    tickSpacing: number
): bigint {
    const targetTick = priceToTick(
        targetPrice,
        tickSpacing,
        baseTokenAddress,
        quoteTokenAddress,
        baseTokenDecimals
    );

    const baseIsToken0 = BigInt(baseTokenAddress) < BigInt(quoteTokenAddress);

    // Convert tick to sqrtPriceX96 for hypothetical price point
    const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(targetTick).toString());
    return calculatePositionValue(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
        baseIsToken0
    );
}
