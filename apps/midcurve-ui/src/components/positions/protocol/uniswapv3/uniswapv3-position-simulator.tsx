/**
 * UniswapV3PositionSimulator - Interactive price simulation for position states
 *
 * Allows users to simulate position PnL at different price points using a slider.
 * The slider range extends 30% below lower range and 30% above upper range.
 */

"use client";

import { useState, useMemo } from "react";

import { formatCompactValue } from "@/lib/fraction-format";
import { SlidersHorizontal } from "lucide-react";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import {
  getTokenAmountsFromLiquidity,
  calculatePositionValue,
  tickToPrice,
  priceToTick,
} from "@midcurve/shared";
import { TickMath } from "@uniswap/v3-sdk";
import { UniswapV3MiniPnLCurve } from "./uniswapv3-mini-pnl-curve";

interface UniswapV3PositionSimulatorProps {
  position: GetUniswapV3PositionResponse;
}

interface SimulatedState {
  baseTokenAmount: bigint;
  quoteTokenAmount: bigint;
  poolPrice: bigint;
  positionValue: bigint;
  pnlExcludingFees: bigint;
  adjustedPnlExcludingFees: bigint; // PnL adjusted for SL/TP orders
  tick: number;
}

export function UniswapV3PositionSimulator({
  position,
}: UniswapV3PositionSimulatorProps) {
  // Extract tokens
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };
  const positionConfig = position.config as {
    tickLower: number;
    tickUpper: number;
  };
  const poolConfig = position.pool.config as { tickSpacing: number };

  // Calculate price range for slider (30% below lower, 30% above upper)
  const { minPrice, maxPrice, lowerRangePrice, upperRangePrice } =
    useMemo(() => {
      // When isToken0Quote = true, tick-to-price relationship is inverted:
      // - tickLower gives HIGHER price (more quote per base)
      // - tickUpper gives LOWER price (fewer quote per base)
      const priceAtTickLower = tickToPrice(
        positionConfig.tickLower,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals)
      );

      const priceAtTickUpper = tickToPrice(
        positionConfig.tickUpper,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals)
      );

      // Swap prices when quote is token0 (inverted tick-price relationship)
      const lowerPrice = position.isToken0Quote ? priceAtTickUpper : priceAtTickLower;
      const upperPrice = position.isToken0Quote ? priceAtTickLower : priceAtTickUpper;

      const rangeWidth = upperPrice - lowerPrice;
      const extension = (rangeWidth * 30n) / 100n;

      return {
        minPrice: lowerPrice - extension,
        maxPrice: upperPrice + extension,
        lowerRangePrice: lowerPrice,
        upperRangePrice: upperPrice,
      };
    }, [
      positionConfig.tickLower,
      positionConfig.tickUpper,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      baseToken.decimals,
      position.isToken0Quote,
    ]);

  // Slider state - use percentage (0-100) for smooth sliding
  const [sliderValue, setSliderValue] = useState(50);

  // Calculate simulated price from slider value
  const simulatedPrice = useMemo(() => {
    const range = maxPrice - minPrice;
    return minPrice + (range * BigInt(sliderValue)) / 100n;
  }, [sliderValue, minPrice, maxPrice]);

  // Calculate simulated tick from price
  const simulatedTick = useMemo(() => {
    return priceToTick(
      simulatedPrice,
      poolConfig.tickSpacing,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      Number(baseToken.decimals)
    );
  }, [
    simulatedPrice,
    poolConfig.tickSpacing,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    baseToken.decimals,
  ]);

  // Calculate position state at simulated tick
  const simulatedState: SimulatedState = useMemo(() => {
    const liquidity = BigInt(
      (position.state as { liquidity: string }).liquidity
    );
    const sqrtPriceX96 = BigInt(
      TickMath.getSqrtRatioAtTick(simulatedTick).toString()
    );

    // Calculate token amounts at this tick
    const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
      liquidity,
      sqrtPriceX96,
      positionConfig.tickLower,
      positionConfig.tickUpper
    );

    // Determine base and quote amounts
    const baseTokenAmount = position.isToken0Quote
      ? token1Amount
      : token0Amount;
    const quoteTokenAmount = position.isToken0Quote
      ? token0Amount
      : token1Amount;

    // Calculate price at this tick
    const poolPrice = tickToPrice(
      simulatedTick,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      Number(baseToken.decimals)
    );

    // Calculate position value at this tick
    const baseIsToken0 = !position.isToken0Quote;
    const positionValue = calculatePositionValue(
      liquidity,
      sqrtPriceX96,
      positionConfig.tickLower,
      positionConfig.tickUpper,
      baseIsToken0
    );

    // Calculate PnL excluding fees (raw, without order adjustments)
    const currentCostBasis = BigInt(position.currentCostBasis);
    const realizedPnL = BigInt(position.realizedPnl);
    const collectedFees = BigInt(position.collectedFees);
    const unrealizedPnL = positionValue - currentCostBasis;
    const pnlExcludingFees = realizedPnL + unrealizedPnL + collectedFees;

    // Find adjusted PnL from curve data (accounts for SL/TP orders)
    let adjustedPnlExcludingFees = pnlExcludingFees;
    if (position.pnlCurve?.curve && position.pnlCurve.curve.length > 0) {
      // Find the closest point in the curve to the simulated price
      let closestPoint = position.pnlCurve.curve[0];
      let minDiff = Math.abs(Number(BigInt(closestPoint.price) - poolPrice));

      for (const point of position.pnlCurve.curve) {
        const diff = Math.abs(Number(BigInt(point.price) - poolPrice));
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = point;
        }
      }

      // Use adjusted PnL from curve (this accounts for SL/TP flattening)
      // The curve's adjustedPnl is unrealized PnL with order effects
      // We need to add realized PnL and collected fees to match our formula
      const adjustedUnrealizedPnL = BigInt(closestPoint.adjustedPnl);
      adjustedPnlExcludingFees = realizedPnL + adjustedUnrealizedPnL + collectedFees;
    }

    return {
      baseTokenAmount,
      quoteTokenAmount,
      poolPrice,
      positionValue,
      pnlExcludingFees,
      adjustedPnlExcludingFees,
      tick: simulatedTick,
    };
  }, [
    position,
    simulatedTick,
    positionConfig.tickLower,
    positionConfig.tickUpper,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    baseToken.decimals,
  ]);

  // Format prices for display
  const quoteDivisor = 10n ** BigInt(quoteToken.decimals);
  const formatPrice = (price: bigint) => {
    return (Number(price) / Number(quoteDivisor)).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-purple-500/20 rounded-lg">
          <SlidersHorizontal className="w-5 h-5 text-purple-400" />
        </div>
        <h4 className="text-lg font-semibold text-white">Price Simulation</h4>
      </div>

      {/* Price Slider */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-slate-400 mb-2">
          <span>{formatPrice(minPrice)}</span>
          <span className="text-purple-400 font-medium">
            {formatPrice(simulatedPrice)} {quoteToken.symbol}
          </span>
          <span>{formatPrice(maxPrice)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={sliderValue}
          onChange={(e) => setSliderValue(Number(e.target.value))}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:bg-purple-500
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:hover:bg-purple-400
            [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:bg-purple-500
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:cursor-pointer
            [&::-moz-range-thumb]:border-0"
        />
        {/* Range markers */}
        <div className="relative w-full h-1 mt-1">
          {/* Lower range marker */}
          <div
            className="absolute w-0.5 h-2 bg-cyan-400 -top-0.5"
            style={{
              left: `${
                Number(
                  ((lowerRangePrice - minPrice) * 100n) / (maxPrice - minPrice)
                )
              }%`,
            }}
            title={`Lower Range: ${formatPrice(lowerRangePrice)}`}
          />
          {/* Upper range marker */}
          <div
            className="absolute w-0.5 h-2 bg-cyan-400 -top-0.5"
            style={{
              left: `${
                Number(
                  ((upperRangePrice - minPrice) * 100n) / (maxPrice - minPrice)
                )
              }%`,
            }}
            title={`Upper Range: ${formatPrice(upperRangePrice)}`}
          />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left Half - Data */}
        <div className="flex-1 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Simulated Price:</span>
            <span className="text-purple-400 font-medium">
              {formatCompactValue(simulatedState.poolPrice, quoteToken.decimals)}{" "}
              {quoteToken.symbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Base Token:</span>
            <div className="flex items-center gap-2 text-white">
              {baseToken.logoUrl && (
                <img
                  src={baseToken.logoUrl}
                  alt={baseToken.symbol}
                  width={16}
                  height={16}
                  className="rounded-full"
                />
              )}
              <span>
                {formatCompactValue(
                  simulatedState.baseTokenAmount,
                  baseToken.decimals
                )}{" "}
                {baseToken.symbol}
              </span>
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Quote Token:</span>
            <div className="flex items-center gap-2 text-white">
              {quoteToken.logoUrl && (
                <img
                  src={quoteToken.logoUrl}
                  alt={quoteToken.symbol}
                  width={16}
                  height={16}
                  className="rounded-full"
                />
              )}
              <span>
                {formatCompactValue(
                  simulatedState.quoteTokenAmount,
                  quoteToken.decimals
                )}{" "}
                {quoteToken.symbol}
              </span>
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Position Value:</span>
            <span className="text-white">
              {formatCompactValue(
                simulatedState.positionValue,
                quoteToken.decimals
              )}{" "}
              {quoteToken.symbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">PnL (Excluding Unclaimed Fees):</span>
            <span
              className={`${
                simulatedState.adjustedPnlExcludingFees > 0n
                  ? "text-green-400"
                  : simulatedState.adjustedPnlExcludingFees < 0n
                  ? "text-red-400"
                  : "text-slate-400"
              }`}
            >
              {formatCompactValue(
                simulatedState.adjustedPnlExcludingFees,
                quoteToken.decimals
              )}{" "}
              {quoteToken.symbol}
            </span>
          </div>
        </div>

        {/* Right Half - Mini PnL Curve with moving marker */}
        <div className="flex-1 flex items-center justify-center">
          <UniswapV3MiniPnLCurve
            position={position as any}
            width={240}
            height={144}
            overrideTick={simulatedState.tick}
          />
        </div>
      </div>
    </div>
  );
}
