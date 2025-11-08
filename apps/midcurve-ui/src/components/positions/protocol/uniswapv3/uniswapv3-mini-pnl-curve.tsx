/**
 * UniswapV3MiniPnLCurve - Protocol-specific mini PnL curve for Uniswap V3 positions
 *
 * Renders a compact SVG visualization of the position's PnL curve showing:
 * - Position value across price range (white line)
 * - Positive PnL area (green fill)
 * - Negative PnL area (red fill)
 * - Range boundaries (cyan dashed lines)
 * - Current price marker (blue circle)
 * - Zero line (gray horizontal)
 */

"use client";

import { useMemo } from "react";
import type { ListPositionData } from "@midcurve/api-shared";
import { generatePnLCurve, tickToPrice } from "@midcurve/shared";

interface UniswapV3MiniPnLCurveProps {
  position: ListPositionData;
  width?: number;
  height?: number;
  /**
   * Optional tick override for hypothetical price scenarios.
   * When provided, the current price marker will be shown at this tick
   * instead of the actual pool's current tick.
   */
  overrideTick?: number;
}

interface CurvePoint {
  price: number;
  pnl: number;
  phase: "below" | "in-range" | "above";
}

export function UniswapV3MiniPnLCurve({
  position,
  width = 120,
  height = 60,
  overrideTick,
}: UniswapV3MiniPnLCurveProps) {
  // Extract Uniswap V3 specific data from position
  const curveData = useMemo(() => {
    try {
      // Type assertion for Uniswap V3 specific fields
      const config = position.config as {
        tickLower: number;
        tickUpper: number;
      };

      const state = position.state as {
        liquidity: string;
      };

      const poolConfig = position.pool.config as {
        tickSpacing: number;
      };

      const poolState = position.pool.state as {
        currentTick: number;
      };

      // Validation
      const liquidity = BigInt(state.liquidity);
      if (liquidity === 0n) {
        return null;
      }

      if (config.tickLower >= config.tickUpper) {
        return null;
      }

      // Extract cost basis (already in quote token units)
      const costBasis = BigInt(position.currentCostBasis);

      // Determine base/quote tokens and extract addresses
      const baseToken = position.isToken0Quote
        ? position.pool.token1
        : position.pool.token0;
      const quoteToken = position.isToken0Quote
        ? position.pool.token0
        : position.pool.token1;

      // Extract token addresses from config (ERC20 tokens)
      const baseTokenConfig = baseToken.config as { address: string };
      const quoteTokenConfig = quoteToken.config as { address: string };

      // Calculate price range boundaries
      const lowerPrice = tickToPrice(
        config.tickLower,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals)
      );

      const upperPrice = tickToPrice(
        config.tickUpper,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals)
      );

      // Calculate ±50% buffer around position range
      const rangeWidth = upperPrice - lowerPrice;
      const buffer = rangeWidth / 2n;
      const minPrice = lowerPrice > buffer ? lowerPrice - buffer : lowerPrice / 2n;
      const maxPrice = upperPrice + buffer;

      // Generate PnL curve with 100 points
      const pnlPoints = generatePnLCurve(
        liquidity,
        config.tickLower,
        config.tickUpper,
        costBasis,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals),
        poolConfig.tickSpacing,
        { min: minPrice, max: maxPrice },
        100
      );

      // Transform bigint values to numbers for SVG rendering
      const quoteDecimals = Number(quoteToken.decimals);
      const quoteDivisor = Number(10n ** BigInt(quoteDecimals));

      const points: CurvePoint[] = pnlPoints.map((point) => ({
        price: Number(point.price) / quoteDivisor,
        pnl: Number(point.pnl) / quoteDivisor,
        phase: point.phase,
      }));

      // Find current price index using current tick (or override tick for hypothetical scenarios)
      // Convert tick to price for marker placement
      const tickForMarker = overrideTick !== undefined ? overrideTick : poolState.currentTick;
      const currentPriceBigInt = tickToPrice(
        tickForMarker,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals)
      );
      const currentPriceNumber = Number(currentPriceBigInt) / quoteDivisor;

      let currentPriceIndex = 0;
      let minDistance = Infinity;
      points.forEach((point, i) => {
        const distance = Math.abs(point.price - currentPriceNumber);
        if (distance < minDistance) {
          minDistance = distance;
          currentPriceIndex = i;
        }
      });

      // Calculate ranges for scaling
      const allPrices = points.map((p) => p.price);
      const allPnls = points.map((p) => p.pnl);

      return {
        points,
        priceRange: {
          min: Math.min(...allPrices),
          max: Math.max(...allPrices),
        },
        pnlRange: {
          min: Math.min(...allPnls),
          max: Math.max(...allPnls),
        },
        currentPriceIndex,
        lowerPrice: Number(lowerPrice) / quoteDivisor,
        upperPrice: Number(upperPrice) / quoteDivisor,
      };
    } catch (error) {
      console.error("Error generating Uniswap V3 PnL curve:", error);
      return null;
    }
  }, [position, overrideTick]);

  // Show N/A state when curve data is unavailable
  if (!curveData || !curveData.points || curveData.points.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-slate-700/30 rounded border border-slate-600/50"
        style={{ width, height }}
        title="PnL curve not available"
      >
        <span className="text-xs text-slate-500">N/A</span>
      </div>
    );
  }

  const { points, priceRange, pnlRange, currentPriceIndex, lowerPrice, upperPrice } = curveData;

  // SVG coordinate scaling functions
  const xScale = (price: number) => {
    const range = priceRange.max - priceRange.min;
    if (range === 0) return width / 2;
    return ((price - priceRange.min) / range) * width;
  };

  const yScale = (pnl: number) => {
    const range = pnlRange.max - pnlRange.min;
    if (range === 0) return height / 2;
    return height - ((pnl - pnlRange.min) / range) * height;
  };

  // Generate SVG path for PnL curve
  const pathData = points
    .map((point, i) => {
      const x = xScale(point.price);
      const y = yScale(point.pnl);
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(" ");

  // Calculate key positions
  const lowerBoundaryX = xScale(lowerPrice);
  const upperBoundaryX = xScale(upperPrice);
  const zeroLineY = yScale(0);
  const currentPoint = points[currentPriceIndex];
  const currentX = xScale(currentPoint.price);
  const currentY = yScale(currentPoint.pnl);

  // Generate unique IDs for clip paths (avoid conflicts with multiple positions)
  const uniqueId = `${position.protocol}-${position.id}`;

  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
    >
      {/* Clip paths for PnL areas */}
      <defs>
        {/* Positive PnL area (above zero line) */}
        <clipPath id={`positivePnL-${uniqueId}`}>
          <rect
            x="0"
            y="0"
            width={width}
            height={Math.max(0, Math.min(height, zeroLineY))}
          />
        </clipPath>
        {/* Negative PnL area (below zero line) */}
        <clipPath id={`negativePnL-${uniqueId}`}>
          <rect
            x="0"
            y={Math.max(0, Math.min(height, zeroLineY))}
            width={width}
            height={height - Math.max(0, Math.min(height, zeroLineY))}
          />
        </clipPath>
      </defs>

      {/* Positive PnL fill (green) */}
      {(() => {
        const effectiveZeroY = Math.max(0, Math.min(height, zeroLineY));
        const shouldShowPositiveFill =
          zeroLineY > 0 || (zeroLineY <= 0 && pnlRange.min >= 0);

        return (
          shouldShowPositiveFill && (
            <path
              d={`${pathData} L ${width} ${effectiveZeroY} L 0 ${effectiveZeroY} Z`}
              fill="rgba(34, 197, 94, 0.3)"
              clipPath={`url(#positivePnL-${uniqueId})`}
            />
          )
        );
      })()}

      {/* Negative PnL fill (red) */}
      {(() => {
        const effectiveZeroY = Math.max(0, Math.min(height, zeroLineY));
        const shouldShowNegativeFill =
          zeroLineY < height || (zeroLineY >= height && pnlRange.max <= 0);

        return (
          shouldShowNegativeFill && (
            <path
              d={`${pathData} L ${width} ${effectiveZeroY} L 0 ${effectiveZeroY} Z`}
              fill="rgba(239, 68, 68, 0.3)"
              clipPath={`url(#negativePnL-${uniqueId})`}
            />
          )
        );
      })()}

      {/* Zero line (gray horizontal) */}
      {zeroLineY >= 0 && zeroLineY <= height && (
        <line
          x1={0}
          y1={zeroLineY}
          x2={width}
          y2={zeroLineY}
          stroke="#64748b"
          strokeWidth={1.5}
          opacity={0.8}
        />
      )}

      {/* PnL curve (white line) */}
      <path
        d={pathData}
        fill="none"
        stroke="#ffffff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Range boundary lines (cyan dashed) */}
      <line
        x1={lowerBoundaryX}
        y1={0}
        x2={lowerBoundaryX}
        y2={height}
        stroke="#06b6d4"
        strokeWidth={1.5}
        opacity={0.8}
        strokeDasharray="3,3"
      />
      <line
        x1={upperBoundaryX}
        y1={0}
        x2={upperBoundaryX}
        y2={height}
        stroke="#06b6d4"
        strokeWidth={1.5}
        opacity={0.8}
        strokeDasharray="3,3"
      />

      {/* Current price marker (blue circle) */}
      <circle
        cx={currentX}
        cy={currentY}
        r={4}
        fill="#60a5fa"
        stroke="#1e293b"
        strokeWidth={1}
      />
    </svg>
  );
}
