/**
 * UniswapV3MiniPnLCurve - Protocol-specific mini PnL curve for Uniswap V3 positions
 *
 * Renders a compact SVG visualization of the position's PnL curve showing:
 * - Position value across price range (white line) with order effects (SL/TP)
 * - Positive PnL area (green fill)
 * - Negative PnL area (red fill)
 * - Range boundaries (cyan dashed lines)
 * - Current price marker (blue circle)
 * - Zero line (gray horizontal)
 *
 * Generates PnL curve data locally using UniswapV3Position.forSimulation()
 * and CloseOrderSimulationOverlay (same pattern as wizard components).
 */

"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import {
  tickToPrice,
  calculatePositionValue,
  UniswapV3Pool,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
} from "@midcurve/shared";
import type { PoolJSON } from "@midcurve/shared";
import type { SerializedUniswapV3CloseOrderConfig, SwapConfig } from "@midcurve/api-shared";
import { PnLCurveTooltip } from "../../pnl-curve-tooltip";

interface UniswapV3MiniPnLCurveProps {
  position: UniswapV3PositionData;
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

/** Number of points to generate for the mini curve */
const NUM_CURVE_POINTS = 60;

export function UniswapV3MiniPnLCurve({
  position,
  width = 120,
  height = 60,
  overrideTick,
}: UniswapV3MiniPnLCurveProps) {
  // Tooltip state
  const [hoveredPoint, setHoveredPoint] = useState<CurvePoint | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Extract base/quote token info
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };
  const isToken0Base = !position.isToken0Quote;

  // Extract SL/TP prices and swap configs from active close orders
  const closeOrderData = useMemo(() => {
    let stopLossPrice: bigint | null = null;
    let takeProfitPrice: bigint | null = null;
    let slSwapConfig: SwapConfig | null = null;
    let tpSwapConfig: SwapConfig | null = null;

    if (!position.activeCloseOrders?.length) {
      return { stopLossPrice, takeProfitPrice, slSwapConfig, tpSwapConfig };
    }

    const token0Decimals = position.pool.token0.decimals;
    const token1Decimals = position.pool.token1.decimals;

    for (const order of position.activeCloseOrders) {
      const orderConfig = order.config as unknown as SerializedUniswapV3CloseOrderConfig;
      if (!orderConfig.triggerMode) continue;

      try {
        if (orderConfig.triggerMode === 'LOWER' && orderConfig.sqrtPriceX96Lower) {
          const sqrtPriceX96 = BigInt(orderConfig.sqrtPriceX96Lower);
          const Q96 = 2n ** 96n;
          const Q192 = Q96 * Q96;
          const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;

          if (isToken0Base) {
            const decimalDiff = token0Decimals - token1Decimals;
            if (decimalDiff >= 0) {
              stopLossPrice = (rawPriceNum * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteToken.decimals)) / Q192;
            } else {
              stopLossPrice = (rawPriceNum * 10n ** BigInt(quoteToken.decimals)) / (Q192 * 10n ** BigInt(-decimalDiff));
            }
          } else {
            const decimalDiff = token1Decimals - token0Decimals;
            if (decimalDiff >= 0) {
              stopLossPrice = (Q192 * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteToken.decimals)) / rawPriceNum;
            } else {
              stopLossPrice = (Q192 * 10n ** BigInt(quoteToken.decimals)) / (rawPriceNum * 10n ** BigInt(-decimalDiff));
            }
          }

          if (orderConfig.swapConfig?.enabled) {
            slSwapConfig = orderConfig.swapConfig;
          }
        }

        if (orderConfig.triggerMode === 'UPPER' && orderConfig.sqrtPriceX96Upper) {
          const sqrtPriceX96 = BigInt(orderConfig.sqrtPriceX96Upper);
          const Q96 = 2n ** 96n;
          const Q192 = Q96 * Q96;
          const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;

          if (isToken0Base) {
            const decimalDiff = token0Decimals - token1Decimals;
            if (decimalDiff >= 0) {
              takeProfitPrice = (rawPriceNum * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteToken.decimals)) / Q192;
            } else {
              takeProfitPrice = (rawPriceNum * 10n ** BigInt(quoteToken.decimals)) / (Q192 * 10n ** BigInt(-decimalDiff));
            }
          } else {
            const decimalDiff = token1Decimals - token0Decimals;
            if (decimalDiff >= 0) {
              takeProfitPrice = (Q192 * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteToken.decimals)) / rawPriceNum;
            } else {
              takeProfitPrice = (Q192 * 10n ** BigInt(quoteToken.decimals)) / (rawPriceNum * 10n ** BigInt(-decimalDiff));
            }
          }

          if (orderConfig.swapConfig?.enabled) {
            tpSwapConfig = orderConfig.swapConfig;
          }
        }
      } catch {
        // Ignore conversion errors for individual orders
      }
    }

    return { stopLossPrice, takeProfitPrice, slSwapConfig, tpSwapConfig };
  }, [position.activeCloseOrders, position.pool.token0.decimals, position.pool.token1.decimals, isToken0Base, quoteToken.decimals]);

  // Create simulation position with SL/TP overlay
  const simulationPosition = useMemo(() => {
    const posConfig = position.config as { tickLower: number; tickUpper: number };
    const posState = position.state as { liquidity: string };
    const poolState = position.pool.state as { sqrtPriceX96: string };

    const liquidity = BigInt(posState.liquidity);
    if (liquidity <= 0n) return null;

    try {
      const pool = UniswapV3Pool.fromJSON(position.pool as unknown as PoolJSON);
      const sqrtPriceX96 = BigInt(poolState.sqrtPriceX96);
      const costBasis = calculatePositionValue(
        liquidity, sqrtPriceX96,
        posConfig.tickLower, posConfig.tickUpper, isToken0Base
      );
      if (costBasis === 0n) return null;

      const basePosition = UniswapV3Position.forSimulation({
        pool,
        isToken0Quote: position.isToken0Quote,
        tickLower: posConfig.tickLower,
        tickUpper: posConfig.tickUpper,
        liquidity,
        costBasis,
      });

      return new CloseOrderSimulationOverlay({
        underlyingPosition: basePosition,
        stopLossPrice: closeOrderData.stopLossPrice,
        takeProfitPrice: closeOrderData.takeProfitPrice,
        stopLossSwapConfig: closeOrderData.slSwapConfig,
        takeProfitSwapConfig: closeOrderData.tpSwapConfig,
      });
    } catch {
      return null;
    }
  }, [position.pool, position.config, position.state, position.isToken0Quote, isToken0Base, closeOrderData]);

  // Generate PnL curve data locally
  const curveData = useMemo(() => {
    if (!simulationPosition) return null;

    try {
      const posConfig = position.config as { tickLower: number; tickUpper: number };
      const poolState = position.pool.state as { currentTick: number };
      const quoteDecimals = quoteToken.decimals;
      const quoteDecimalsDivisor = 10n ** BigInt(quoteDecimals);
      const quoteDivisor = Number(quoteDecimalsDivisor);

      // Calculate range boundary prices from ticks
      const lowerPriceBigint = tickToPrice(
        posConfig.tickLower,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        baseToken.decimals
      );
      const upperPriceBigint = tickToPrice(
        posConfig.tickUpper,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        baseToken.decimals
      );

      const lowerPrice = Number(lowerPriceBigint) / quoteDivisor;
      const upperPrice = Number(upperPriceBigint) / quoteDivisor;

      // Calculate current price
      const currentTick = overrideTick ?? poolState.currentTick;
      const currentPriceBigint = tickToPrice(
        currentTick,
        baseTokenConfig.address,
        quoteTokenConfig.address,
        baseToken.decimals
      );
      const currentPriceNumber = Number(currentPriceBigint) / quoteDivisor;

      // Determine visual range: extend 50% beyond tick range boundaries
      const rangeSpan = upperPrice - lowerPrice;
      const extension = rangeSpan * 0.5;
      const visualMin = Math.max(lowerPrice - extension, lowerPrice * 0.1);
      const visualMax = upperPrice + extension;

      if (visualMin <= 0 || visualMax <= 0 || visualMin >= visualMax) {
        return null;
      }

      // Generate evenly-spaced price points
      const points: CurvePoint[] = [];

      for (let i = 0; i <= NUM_CURVE_POINTS; i++) {
        const priceDisplay = visualMin + (visualMax - visualMin) * (i / NUM_CURVE_POINTS);

        // Convert display price to bigint (quote token units)
        const priceBigint = BigInt(Math.floor(priceDisplay * quoteDivisor));
        if (priceBigint <= 0n) continue;

        const result = simulationPosition.simulatePnLAtPrice(priceBigint);

        const positionValueDisplay = Number(result.positionValue) / quoteDivisor;
        const pnlDisplay = Number(result.pnlValue) / quoteDivisor;

        // Determine phase based on price relative to range
        let phase: "below" | "in-range" | "above";
        if (priceDisplay < lowerPrice) {
          phase = "below";
        } else if (priceDisplay > upperPrice) {
          phase = "above";
        } else {
          phase = "in-range";
        }

        points.push({
          price: priceDisplay,
          positionValue: positionValueDisplay,
          pnl: pnlDisplay,
          pnlPercent: result.pnlPercent,
          phase,
        });
      }

      if (points.length === 0) return null;

      // Calculate ranges for scaling
      const allPrices = points.map((p) => p.price);
      const allPnls = points.map((p) => p.pnl);
      const priceRangeMin = Math.min(...allPrices);
      const priceRangeMax = Math.max(...allPrices);

      // Find closest point in curve for current price marker
      let currentPriceIndex: number;
      if (currentPriceNumber >= priceRangeMax) {
        currentPriceIndex = points.length - 1;
      } else if (currentPriceNumber <= priceRangeMin) {
        currentPriceIndex = 0;
      } else {
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
        lowerPrice,
        upperPrice,
      };
    } catch (error) {
      console.error("Error generating PnL curve data:", error);
      return null;
    }
  }, [simulationPosition, position.config, position.pool.state, overrideTick, quoteToken.decimals, baseTokenConfig.address, quoteTokenConfig.address, baseToken.decimals]);

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
