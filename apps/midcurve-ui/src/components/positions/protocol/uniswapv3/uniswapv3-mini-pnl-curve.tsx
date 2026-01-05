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

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ListPositionData } from "@midcurve/api-shared";
import { generatePnLCurve, tickToPrice } from "@midcurve/shared";
import { PnLCurveTooltip } from "../../pnl-curve-tooltip";

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
  positionValue: number;
  pnlPercent: number;
  phase: "below" | "in-range" | "above";
}

export function UniswapV3MiniPnLCurve({
  position,
  width = 120,
  height = 60,
  overrideTick,
}: UniswapV3MiniPnLCurveProps) {
  // Tooltip state
  const [hoveredPoint, setHoveredPoint] = useState<CurvePoint | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

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
      // When isToken0Quote = true, tick-to-price relationship is inverted:
      // - tickLower gives HIGHER price (more quote per base)
      // - tickUpper gives LOWER price (fewer quote per base)
      // So we need to swap them for correct display
      const priceAtTickLower = tickToPrice(
        config.tickLower,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals)
      );

      const priceAtTickUpper = tickToPrice(
        config.tickUpper,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        Number(baseToken.decimals)
      );

      // Swap prices when quote is token0 (inverted tick-price relationship)
      const lowerPrice = position.isToken0Quote ? priceAtTickUpper : priceAtTickLower;
      const upperPrice = position.isToken0Quote ? priceAtTickLower : priceAtTickUpper;

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
        positionValue: Number(point.positionValue) / quoteDivisor,
        pnlPercent: point.pnlPercent,
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

      // Calculate ranges for scaling (needed for bounds checking below)
      const allPrices = points.map((p) => p.price);
      const allPnls = points.map((p) => p.pnl);
      const priceRangeMin = Math.min(...allPrices);
      const priceRangeMax = Math.max(...allPrices);

      // Find current price index
      // Handle prices outside curve range by using edge indices directly
      // This is important when currentPriceNumber is astronomically outside the range
      // (e.g., at MIN_TICK the price can be 340 quadrillion, far outside the curve)
      let currentPriceIndex: number;
      if (currentPriceNumber >= priceRangeMax) {
        // Price above range -> rightmost point (above range on curve)
        currentPriceIndex = points.length - 1;
      } else if (currentPriceNumber <= priceRangeMin) {
        // Price below range -> leftmost point (below range on curve)
        currentPriceIndex = 0;
      } else {
        // Price within range -> search for closest point
        currentPriceIndex = 0;
        let minDistance = Infinity;
        points.forEach((point, i) => {
          const distance = Math.abs(point.price - currentPriceNumber);
          if (distance < minDistance) {
            minDistance = distance;
            currentPriceIndex = i;
          }
        });
      }

      return {
        points,
        priceRange: {
          min: priceRangeMin,
          max: priceRangeMax,
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

  // Get quote token for tooltip
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Mouse event handlers for tooltip
  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Find closest point by X coordinate
    const closestPoint = points.reduce((closest, point) => {
      const pointX = xScale(point.price);
      const closestX = xScale(closest.price);
      return Math.abs(pointX - mouseX) < Math.abs(closestX - mouseX)
        ? point
        : closest;
    });

    setHoveredPoint(closestPoint);

    // Calculate tooltip position with edge detection
    const OFFSET = 10;
    const tooltipWidth = 280;
    const tooltipHeight = 120;

    // Use clientX/clientY for fixed positioning (viewport coordinates)
    let x = e.clientX + OFFSET;
    let y = e.clientY + OFFSET;

    // Flip horizontally if too close to right edge
    if (x + tooltipWidth > window.innerWidth) {
      x = e.clientX - tooltipWidth - OFFSET;
    }

    // Flip vertically if too close to bottom
    if (y + tooltipHeight > window.innerHeight) {
      y = e.clientY - tooltipHeight - OFFSET;
    }

    setTooltipPosition({ x, y });
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  return (
    <div className="relative inline-block">
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

      {/* Invisible overlay for mouse tracking */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="cursor-crosshair"
      />
    </svg>

      {/* Tooltip - render via portal to avoid parent container positioning issues */}
      {hoveredPoint && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }}
        >
          <PnLCurveTooltip
            price={hoveredPoint.price}
            positionValue={hoveredPoint.positionValue}
            pnl={hoveredPoint.pnl}
            pnlPercent={hoveredPoint.pnlPercent}
            quoteToken={quoteToken as any}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
