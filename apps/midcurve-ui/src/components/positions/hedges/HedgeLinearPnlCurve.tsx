/**
 * HedgeLinearPnlCurve - Linear PnL visualization for perpetual positions
 *
 * Renders a simple SVG showing:
 * - Linear PnL line (perps have linear PnL relationship with price)
 * - Positive PnL area (green fill)
 * - Negative PnL area (red fill)
 * - Entry price marker (vertical dashed line)
 * - Current price marker (blue circle)
 * - Zero line (gray horizontal)
 */

'use client';

import { useMemo } from 'react';
import type { MockHedge } from './mock-hedge-data';

interface HedgeLinearPnlCurveProps {
  hedge: MockHedge;
  width?: number;
  height?: number;
  /**
   * Quote token symbol for display (not used in SVG but available for future tooltip)
   */
  quoteSymbol?: string;
}

export function HedgeLinearPnlCurve({
  hedge,
  width = 120,
  height = 60,
}: HedgeLinearPnlCurveProps) {
  // Calculate curve data
  const curveData = useMemo(() => {
    const { entryPrice, markPrice, direction, leverage } = hedge;

    // Price range: 20% below and above entry price
    const priceRange = entryPrice * 0.2;
    const minPrice = entryPrice - priceRange;
    const maxPrice = entryPrice + priceRange;

    // Calculate PnL at min and max prices
    // For long: PnL = (currentPrice - entryPrice) / entryPrice * leverage * 100
    // For short: PnL = (entryPrice - currentPrice) / entryPrice * leverage * 100
    const calculatePnlPercent = (price: number): number => {
      const priceChange = (price - entryPrice) / entryPrice;
      return direction === 'long'
        ? priceChange * leverage * 100
        : -priceChange * leverage * 100;
    };

    const pnlAtMin = calculatePnlPercent(minPrice);
    const pnlAtMax = calculatePnlPercent(maxPrice);
    const pnlAtCurrent = calculatePnlPercent(markPrice);

    // Determine PnL range for scaling
    const allPnls = [pnlAtMin, pnlAtMax, 0];
    const pnlMin = Math.min(...allPnls);
    const pnlMax = Math.max(...allPnls);

    return {
      minPrice,
      maxPrice,
      entryPrice,
      markPrice,
      pnlAtMin,
      pnlAtMax,
      pnlAtCurrent,
      pnlMin,
      pnlMax,
      direction,
    };
  }, [hedge]);

  const {
    minPrice,
    maxPrice,
    entryPrice,
    markPrice,
    pnlAtMin,
    pnlAtMax,
    pnlAtCurrent,
    pnlMin,
    pnlMax,
    direction,
  } = curveData;

  // SVG coordinate scaling functions
  const xScale = (price: number) => {
    const range = maxPrice - minPrice;
    if (range === 0) return width / 2;
    return ((price - minPrice) / range) * width;
  };

  const yScale = (pnl: number) => {
    const range = pnlMax - pnlMin;
    if (range === 0) return height / 2;
    return height - ((pnl - pnlMin) / range) * height;
  };

  // Calculate key positions
  const lineStartX = 0;
  const lineStartY = yScale(pnlAtMin);
  const lineEndX = width;
  const lineEndY = yScale(pnlAtMax);
  const entryX = xScale(entryPrice);
  const currentX = xScale(markPrice);
  const currentY = yScale(pnlAtCurrent);
  const zeroLineY = yScale(0);

  // Generate unique ID for this curve
  const uniqueId = `hedge-${hedge.id}`;

  // Determine line color based on current PnL
  const isProfit = pnlAtCurrent >= 0;

  return (
    <div className="relative inline-block">
      <svg width={width} height={height} className="overflow-visible">
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
        {zeroLineY > 0 && (
          <polygon
            points={`
              ${lineStartX},${lineStartY}
              ${lineEndX},${lineEndY}
              ${lineEndX},${zeroLineY}
              ${lineStartX},${zeroLineY}
            `}
            fill="rgba(34, 197, 94, 0.3)"
            clipPath={`url(#positivePnL-${uniqueId})`}
          />
        )}

        {/* Negative PnL fill (red) */}
        {zeroLineY < height && (
          <polygon
            points={`
              ${lineStartX},${lineStartY}
              ${lineEndX},${lineEndY}
              ${lineEndX},${zeroLineY}
              ${lineStartX},${zeroLineY}
            `}
            fill="rgba(239, 68, 68, 0.3)"
            clipPath={`url(#negativePnL-${uniqueId})`}
          />
        )}

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

        {/* Linear PnL line (white) */}
        <line
          x1={lineStartX}
          y1={lineStartY}
          x2={lineEndX}
          y2={lineEndY}
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Entry price marker (cyan dashed vertical line) */}
        <line
          x1={entryX}
          y1={0}
          x2={entryX}
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
          fill={isProfit ? "#22c55e" : "#ef4444"}
          stroke="#1e293b"
          strokeWidth={1}
        />

        {/* Direction indicator (small arrow near entry) */}
        {direction === 'short' ? (
          // Down arrow for short
          <path
            d={`M ${entryX - 4} ${height - 8} l 4 6 l 4 -6`}
            fill="none"
            stroke="#ef4444"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          // Up arrow for long
          <path
            d={`M ${entryX - 4} ${8} l 4 -6 l 4 6`}
            fill="none"
            stroke="#22c55e"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}
