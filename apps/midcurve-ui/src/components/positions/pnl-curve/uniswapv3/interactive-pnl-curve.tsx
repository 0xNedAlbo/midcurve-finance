"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  generatePnLCurve,
  tickToPrice,
  compareAddresses,
  getTickSpacing,
} from "@midcurve/shared";

// ============================================================================
// Flexible prop types that work with different data sources
// ============================================================================

/**
 * Minimal pool data needed for PnL curve visualization.
 * Works with both UniswapV3PoolResponse and UniswapV3Pool class.
 */
export interface PnLCurvePoolData {
  token0Address: string;
  token0Decimals: number;
  token1Address: string;
  token1Decimals: number;
  feeBps: number;
  currentTick: number;
  sqrtPriceX96: bigint | string;
}

/**
 * Minimal token data needed for PnL curve visualization.
 * Works with both Erc20TokenResponse and PoolSearchTokenInfo.
 */
export interface PnLCurveTokenData {
  address: string;
  symbol: string;
  decimals: number;
}

export interface InteractivePnLCurveProps {
  // Flexible pool data (can be extracted from any pool type)
  poolData: PnLCurvePoolData;
  // Token info (simpler interface)
  baseToken: PnLCurveTokenData;
  quoteToken: PnLCurveTokenData;
  // Position parameters
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  costBasis: bigint;
  // Visual bounds
  sliderBounds?: { min: number; max: number };
  // Callback for X-axis zoom
  onSliderBoundsChange?: (bounds: { min: number; max: number }) => void;
  // Dimensions
  height?: number;
  className?: string;
}

interface CurveDataPoint {
  price: number;
  positionValue: number;
  pnl: number;
  pnlPercent: number;
  phase: string;
}

// Margins for the chart area
const MARGIN = { top: 20, right: 30, bottom: 40, left: 70 };

// Drag sensitivity for zoom interactions (pixels per 10% zoom)
const DRAG_SENSITIVITY = 50;

// Inner component that receives explicit width
function InteractivePnLCurveInner({
  width,
  height,
  poolData,
  baseToken,
  quoteToken,
  tickLower,
  tickUpper,
  liquidity,
  costBasis,
  sliderBounds,
  onSliderBoundsChange,
}: InteractivePnLCurveProps & { width: number }) {
  // Calculate chart dimensions
  const chartWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const chartHeight = Math.max(0, height! - MARGIN.top - MARGIN.bottom);

  // Local state for Y-axis bounds (PnL percentage range)
  const [yBounds, setYBounds] = useState({ min: -70, max: 30 });

  // Determine token roles
  const isBaseToken0 = useMemo(() => {
    return compareAddresses(poolData.token0Address, baseToken.address) === 0;
  }, [poolData.token0Address, baseToken.address]);

  // Get base token decimals based on token position in pool
  const baseTokenDecimals = isBaseToken0
    ? poolData.token0Decimals
    : poolData.token1Decimals;

  // Calculate lower and upper prices
  const { lowerPrice, upperPrice } = useMemo(() => {
    try {
      const priceAtTickLower = tickToPrice(
        tickLower,
        baseToken.address,
        quoteToken.address,
        baseTokenDecimals
      );

      const priceAtTickUpper = tickToPrice(
        tickUpper,
        baseToken.address,
        quoteToken.address,
        baseTokenDecimals
      );

      const divisor = 10n ** BigInt(quoteToken.decimals);
      const isToken0Quote = !isBaseToken0;

      return {
        lowerPrice: isToken0Quote
          ? Number(priceAtTickUpper) / Number(divisor)
          : Number(priceAtTickLower) / Number(divisor),
        upperPrice: isToken0Quote
          ? Number(priceAtTickLower) / Number(divisor)
          : Number(priceAtTickUpper) / Number(divisor),
      };
    } catch (error) {
      console.error("Error calculating range prices:", error);
      return { lowerPrice: 0, upperPrice: 0 };
    }
  }, [baseToken, quoteToken, tickLower, tickUpper, baseTokenDecimals, isBaseToken0]);

  // Generate PnL curve data
  const curveData = useMemo((): CurveDataPoint[] => {
    if (liquidity === 0n) {
      return [];
    }

    try {
      const tickSpacing = getTickSpacing(poolData.feeBps);
      const visualMin = sliderBounds?.min ?? lowerPrice;
      const visualMax = sliderBounds?.max ?? upperPrice;

      const priceMinBigInt = BigInt(
        Math.floor(visualMin * Number(10n ** BigInt(quoteToken.decimals)))
      );
      const priceMaxBigInt = BigInt(
        Math.floor(visualMax * Number(10n ** BigInt(quoteToken.decimals)))
      );

      const priceMin = priceMinBigInt > 0n ? priceMinBigInt : 1n;
      const priceMax = priceMaxBigInt;

      const data = generatePnLCurve(
        liquidity,
        tickLower,
        tickUpper,
        costBasis,
        baseToken.address,
        quoteToken.address,
        baseToken.decimals,
        tickSpacing,
        { min: priceMin > 0n ? priceMin : 1n, max: priceMax }
      );

      return data.map((point) => {
        const priceDisplay =
          Number(point.price) / Number(10n ** BigInt(quoteToken.decimals));
        const pnlDisplay =
          Number(point.pnl) / Number(10n ** BigInt(quoteToken.decimals));
        const positionValueDisplay =
          Number(point.positionValue) /
          Number(10n ** BigInt(quoteToken.decimals));

        return {
          price: priceDisplay,
          positionValue: positionValueDisplay,
          pnl: pnlDisplay,
          pnlPercent: point.pnlPercent,
          phase: point.phase,
        };
      });
    } catch (error) {
      console.error("Error generating PnL curve:", error);
      return [];
    }
  }, [
    baseToken,
    quoteToken,
    liquidity,
    tickLower,
    tickUpper,
    costBasis,
    lowerPrice,
    upperPrice,
    sliderBounds,
    poolData.feeBps,
  ]);

  // Calculate data bounds for scales
  // Y-axis uses yBounds state (zoomable), X-axis uses sliderBounds prop
  const { priceMin, priceMax } = useMemo(() => {
    if (curveData.length === 0) {
      const fallbackMin = sliderBounds?.min ?? 0;
      const fallbackMax = sliderBounds?.max ?? 100;
      return {
        priceMin: fallbackMin,
        priceMax: fallbackMax,
      };
    }

    const prices = curveData.map((d) => d.price);
    return {
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
    };
  }, [curveData, sliderBounds]);

  // Create scales
  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [priceMin, priceMax],
        range: [0, chartWidth],
      }),
    [priceMin, priceMax, chartWidth]
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [yBounds.min, yBounds.max],
        range: [chartHeight, 0], // Inverted for SVG coordinates
      }),
    [yBounds.min, yBounds.max, chartHeight]
  );

  // Format functions for axes
  const formatPrice = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toFixed(value < 1 ? 4 : 0);
  };

  const formatPnLPercent = (value: number) => {
    return `${value.toFixed(0)}%`;
  };

  // Refs for tracking drag state
  const xDragRef = useRef<{ isDragging: boolean; startX: number; startBounds: { min: number; max: number } }>({
    isDragging: false,
    startX: 0,
    startBounds: { min: 0, max: 0 },
  });

  const yDragRef = useRef<{ isDragging: boolean; startY: number; startBounds: { min: number; max: number } }>({
    isDragging: false,
    startY: 0,
    startBounds: { min: 0, max: 0 },
  });

  // Ref for chart panning
  const chartPanRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startXBounds: { min: number; max: number };
    startYBounds: { min: number; max: number };
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startXBounds: { min: 0, max: 0 },
    startYBounds: { min: 0, max: 0 },
  });

  // State for pan cursor feedback
  const [isPanning, setIsPanning] = useState(false);

  // X-axis drag handlers
  const handleXAxisMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onSliderBoundsChange || !sliderBounds) return;
    e.preventDefault();
    xDragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startBounds: { ...sliderBounds },
    };
  }, [sliderBounds, onSliderBoundsChange]);

  const handleXAxisMouseMove = useCallback((e: MouseEvent) => {
    if (!xDragRef.current.isDragging || !onSliderBoundsChange) return;

    const deltaX = e.clientX - xDragRef.current.startX;
    const zoomFactor = deltaX / DRAG_SENSITIVITY * 0.1; // drag right = zoom in, left = zoom out

    const startRange = xDragRef.current.startBounds.max - xDragRef.current.startBounds.min;
    const center = (xDragRef.current.startBounds.min + xDragRef.current.startBounds.max) / 2;
    const newRange = startRange * (1 - zoomFactor); // negative because drag right = smaller range = zoom in

    // Constrain range - use absolute minimum to prevent collapse near zero
    const absoluteMinRange = 0.0001; // Minimum range to prevent division by zero
    const minRange = Math.max(absoluteMinRange, center * 0.1); // min 10% of center price
    const maxRange = Math.max(absoluteMinRange * 1000, center * 4); // max 400% of center price
    const clampedRange = Math.max(minRange, Math.min(maxRange, newRange));

    let newMin = center - clampedRange / 2;
    let newMax = center + clampedRange / 2;

    // Constrain: prices cannot be negative or zero, use small epsilon
    const minPrice = 0.0001;
    if (newMin < minPrice) {
      newMin = minPrice;
      newMax = newMin + clampedRange;
    }

    onSliderBoundsChange({ min: newMin, max: newMax });
  }, [onSliderBoundsChange]);

  const handleXAxisMouseUp = useCallback(() => {
    xDragRef.current.isDragging = false;
  }, []);

  // Y-axis drag handlers
  const handleYAxisMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    yDragRef.current = {
      isDragging: true,
      startY: e.clientY,
      startBounds: { ...yBounds },
    };
  }, [yBounds]);

  const handleYAxisMouseMove = useCallback((e: MouseEvent) => {
    if (!yDragRef.current.isDragging) return;

    const deltaY = e.clientY - yDragRef.current.startY;
    const zoomFactor = deltaY / DRAG_SENSITIVITY * 0.1; // drag down = zoom out, up = zoom in

    const startRange = yDragRef.current.startBounds.max - yDragRef.current.startBounds.min;
    const center = (yDragRef.current.startBounds.min + yDragRef.current.startBounds.max) / 2;
    const newRange = startRange * (1 + zoomFactor); // positive because drag down = larger range = zoom out

    // Constrain: min 20% range, max 200% range
    const clampedRange = Math.max(20, Math.min(200, newRange));
    let newMin = center - clampedRange / 2;
    let newMax = center + clampedRange / 2;

    // Ensure 0 is visible
    if (newMin > 0) { newMin = -5; newMax = newMin + clampedRange; }
    if (newMax < 0) { newMax = 5; newMin = newMax - clampedRange; }

    // Constrain: min cannot go below -100% (can't lose more than 100%)
    if (newMin < -100) {
      newMin = -100;
      newMax = newMin + clampedRange;
    }

    setYBounds({ min: newMin, max: newMax });
  }, []);

  const handleYAxisMouseUp = useCallback(() => {
    yDragRef.current.isDragging = false;
  }, []);

  // Chart pan handlers (drag to move visible area)
  const handleChartPanMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onSliderBoundsChange || !sliderBounds) return;
    e.preventDefault();
    e.stopPropagation();
    setIsPanning(true);
    chartPanRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startXBounds: { ...sliderBounds },
      startYBounds: { ...yBounds },
    };
  }, [sliderBounds, yBounds, onSliderBoundsChange]);

  const handleChartPanMouseMove = useCallback((e: MouseEvent) => {
    if (!chartPanRef.current.isDragging || !onSliderBoundsChange) return;

    const deltaX = e.clientX - chartPanRef.current.startX;
    const deltaY = e.clientY - chartPanRef.current.startY;

    // Calculate how much to shift based on pixels moved vs chart dimensions
    const xRange = chartPanRef.current.startXBounds.max - chartPanRef.current.startXBounds.min;
    const yRange = chartPanRef.current.startYBounds.max - chartPanRef.current.startYBounds.min;

    // Convert pixel movement to data units (negative because drag left = move view right)
    const xShift = -(deltaX / chartWidth) * xRange;
    const yShift = (deltaY / chartHeight) * yRange; // positive because SVG Y is inverted

    let newXMin = chartPanRef.current.startXBounds.min + xShift;
    let newXMax = chartPanRef.current.startXBounds.max + xShift;
    let newYMin = chartPanRef.current.startYBounds.min + yShift;
    let newYMax = chartPanRef.current.startYBounds.max + yShift;

    // Constrain X: prices cannot be negative or zero
    const minPrice = 0.0001;
    if (newXMin < minPrice) {
      const shift = minPrice - newXMin;
      newXMin = minPrice;
      newXMax += shift;
    }

    // Constrain Y: min cannot go below -100%
    if (newYMin < -100) {
      const shift = -100 - newYMin;
      newYMin = -100;
      newYMax += shift;
    }

    onSliderBoundsChange({ min: newXMin, max: newXMax });
    setYBounds({ min: newYMin, max: newYMax });
  }, [chartWidth, chartHeight, onSliderBoundsChange]);

  const handleChartPanMouseUp = useCallback(() => {
    chartPanRef.current.isDragging = false;
    setIsPanning(false);
  }, []);

  // Attach document-level listeners for drag operations
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleXAxisMouseMove(e);
      handleYAxisMouseMove(e);
      handleChartPanMouseMove(e);
    };

    const handleMouseUp = () => {
      handleXAxisMouseUp();
      handleYAxisMouseUp();
      handleChartPanMouseUp();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    handleXAxisMouseMove, handleYAxisMouseMove, handleChartPanMouseMove,
    handleXAxisMouseUp, handleYAxisMouseUp, handleChartPanMouseUp
  ]);

  if (width < 10 || chartHeight < 10) {
    return null;
  }

  // When liquidity is 0, we still show the grid with a flat line at 0%
  const hasPosition = liquidity > 0n && curveData.length > 0;

  return (
    <svg width={width} height={height}>
      {/* Background */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="#0f172a"
        rx={8}
      />

      <Group left={MARGIN.left} top={MARGIN.top}>
        {/* Chart pan hit area - FIRST so other interactive elements can override it */}
        <rect
          x={0}
          y={0}
          width={chartWidth}
          height={chartHeight}
          fill="transparent"
          style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
          onMouseDown={handleChartPanMouseDown}
        />

        {/* Grid background */}
        <GridRows
          scale={yScale}
          width={chartWidth}
          stroke="#374151"
          strokeOpacity={0.5}
          strokeDasharray="3,3"
          numTicks={6}
        />
        <GridColumns
          scale={xScale}
          height={chartHeight}
          stroke="#374151"
          strokeOpacity={0.5}
          strokeDasharray="3,3"
          numTicks={6}
        />

        {/* Zero line (break-even) - slightly more prominent */}
        {yBounds.min < 0 && yBounds.max > 0 && (
          <line
            x1={0}
            x2={chartWidth}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="4,4"
          />
        )}

        {/* X-Axis (Price) */}
        <AxisBottom
          top={chartHeight}
          scale={xScale}
          tickFormat={(value) => formatPrice(value as number)}
          stroke="#475569"
          tickStroke="#475569"
          tickLabelProps={() => ({
            fill: "#94a3b8",
            fontSize: 11,
            textAnchor: "middle",
            dy: 4,
          })}
          numTicks={6}
          label={`${baseToken.symbol} Price (${quoteToken.symbol})`}
          labelProps={{
            fill: "#64748b",
            fontSize: 11,
            textAnchor: "middle",
          }}
          labelOffset={25}
        />

        {/* Y-Axis (PnL %) */}
        <AxisLeft
          scale={yScale}
          tickFormat={(value) => formatPnLPercent(value as number)}
          stroke="#475569"
          tickStroke="#475569"
          tickLabelProps={() => ({
            fill: "#94a3b8",
            fontSize: 11,
            textAnchor: "end",
            dx: -4,
            dy: 4,
          })}
          numTicks={5}
          label="PnL %"
          labelProps={{
            fill: "#64748b",
            fontSize: 11,
            textAnchor: "middle",
          }}
          labelOffset={45}
        />

        {/* Clip path for curve */}
        <defs>
          <clipPath id="pnl-curve-clip">
            <rect x={0} y={0} width={chartWidth} height={chartHeight} />
          </clipPath>
        </defs>

        {/* PnL Curve Line */}
        {hasPosition && curveData.length > 0 && (
          <g clipPath="url(#pnl-curve-clip)">
            <LinePath
              data={curveData}
              x={(d) => xScale(d.price)}
              y={(d) => yScale(d.pnlPercent)}
              stroke="#3b82f6"
              strokeWidth={2}
              curve={curveMonotoneX}
            />
          </g>
        )}

        {/* Placeholder text when no position */}
        {!hasPosition && (
          <text
            x={chartWidth / 2}
            y={chartHeight / 2}
            fill="#475569"
            fontSize={14}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            Enter token amounts to see PnL curve
          </text>
        )}
      </Group>

      {/* X-axis zoom hit area - drag left/right to zoom */}
      <rect
        x={MARGIN.left}
        y={height! - MARGIN.bottom}
        width={chartWidth}
        height={MARGIN.bottom}
        fill="transparent"
        style={{ cursor: 'ew-resize' }}
        onMouseDown={handleXAxisMouseDown}
      />

      {/* Y-axis zoom hit area - drag up/down to zoom */}
      <rect
        x={0}
        y={MARGIN.top}
        width={MARGIN.left}
        height={chartHeight}
        fill="transparent"
        style={{ cursor: 'ns-resize' }}
        onMouseDown={handleYAxisMouseDown}
      />
    </svg>
  );
}

// Main component with responsive wrapper
export function InteractivePnLCurve({
  height = 320,
  className,
  ...props
}: InteractivePnLCurveProps) {
  return (
    <div className={`w-full ${className ?? ""}`} style={{ height }}>
      <ParentSize>
        {({ width }) => (
          <InteractivePnLCurveInner
            width={width}
            height={height}
            {...props}
          />
        )}
      </ParentSize>
    </div>
  );
}
