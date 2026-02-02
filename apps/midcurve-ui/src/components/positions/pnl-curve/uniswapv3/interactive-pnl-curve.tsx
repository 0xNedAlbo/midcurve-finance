"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { LinePath, Area } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  generatePnLCurve,
  tickToPrice,
  compareAddresses,
  getTickSpacing,
  priceToTick,
  formatCompactValue,
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
  // Callbacks for range boundary changes
  onTickLowerChange?: (newTickLower: number) => void;
  onTickUpperChange?: (newTickUpper: number) => void;
  // Callback when user starts interacting with range boundaries
  onRangeBoundaryInteraction?: () => void;
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
  onTickLowerChange,
  onTickUpperChange,
  onRangeBoundaryInteraction,
}: InteractivePnLCurveProps & { width: number }) {
  // Calculate chart dimensions
  const chartWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const chartHeight = Math.max(0, height! - MARGIN.top - MARGIN.bottom);

  // Local state for Y-axis bounds (PnL percentage range)
  const [yBounds, setYBounds] = useState({ min: -30, max: 15 });

  // Determine token roles
  const isBaseToken0 = useMemo(() => {
    return compareAddresses(poolData.token0Address, baseToken.address) === 0;
  }, [poolData.token0Address, baseToken.address]);

  // Get base token decimals based on token position in pool
  const baseTokenDecimals = isBaseToken0
    ? poolData.token0Decimals
    : poolData.token1Decimals;

  // Calculate lower and upper prices (both bigint for formatting and float for scales)
  const { lowerPrice, upperPrice, lowerPriceBigint, upperPriceBigint } = useMemo(() => {
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

      // Bigint prices in quote currency units (with decimals)
      const lowerBigint = isToken0Quote ? priceAtTickUpper : priceAtTickLower;
      const upperBigint = isToken0Quote ? priceAtTickLower : priceAtTickUpper;

      return {
        lowerPrice: Number(lowerBigint) / Number(divisor),
        upperPrice: Number(upperBigint) / Number(divisor),
        lowerPriceBigint: lowerBigint,
        upperPriceBigint: upperBigint,
      };
    } catch (error) {
      console.error("Error calculating range prices:", error);
      return { lowerPrice: 0, upperPrice: 0, lowerPriceBigint: 0n, upperPriceBigint: 0n };
    }
  }, [baseToken, quoteToken, tickLower, tickUpper, baseTokenDecimals, isBaseToken0]);

  // Calculate current price from pool's current tick
  const { currentPrice, currentPriceBigint } = useMemo(() => {
    try {
      const priceAtCurrentTick = tickToPrice(
        poolData.currentTick,
        baseToken.address,
        quoteToken.address,
        baseTokenDecimals
      );

      const divisor = 10n ** BigInt(quoteToken.decimals);

      return {
        currentPrice: Number(priceAtCurrentTick) / Number(divisor),
        currentPriceBigint: priceAtCurrentTick,
      };
    } catch (error) {
      console.error("Error calculating current price:", error);
      return { currentPrice: 0, currentPriceBigint: 0n };
    }
  }, [poolData.currentTick, baseToken.address, quoteToken.address, baseTokenDecimals, quoteToken.decimals]);

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

  // Find the PnL percentage at the current price by interpolating from curve data
  const currentPricePnlPercent = useMemo(() => {
    if (curveData.length === 0 || currentPrice <= 0) return null;

    // Find the two closest points for interpolation
    let lowerPoint: CurveDataPoint | null = null;
    let upperPoint: CurveDataPoint | null = null;

    for (const point of curveData) {
      if (point.price <= currentPrice) {
        if (!lowerPoint || point.price > lowerPoint.price) {
          lowerPoint = point;
        }
      }
      if (point.price >= currentPrice) {
        if (!upperPoint || point.price < upperPoint.price) {
          upperPoint = point;
        }
      }
    }

    // Interpolate between the two points
    if (lowerPoint && upperPoint) {
      if (lowerPoint.price === upperPoint.price) {
        return lowerPoint.pnlPercent;
      }
      const ratio = (currentPrice - lowerPoint.price) / (upperPoint.price - lowerPoint.price);
      return lowerPoint.pnlPercent + ratio * (upperPoint.pnlPercent - lowerPoint.pnlPercent);
    } else if (lowerPoint) {
      return lowerPoint.pnlPercent;
    } else if (upperPoint) {
      return upperPoint.pnlPercent;
    }

    return null;
  }, [curveData, currentPrice]);

  // Calculate data bounds for scales
  // Y-axis uses yBounds state (zoomable), X-axis uses sliderBounds prop directly
  const { priceMin, priceMax } = useMemo(() => {
    // Use sliderBounds directly to ensure symmetric x-axis around current price
    if (sliderBounds && sliderBounds.min > 0 && sliderBounds.max > 0) {
      return {
        priceMin: sliderBounds.min,
        priceMax: sliderBounds.max,
      };
    }

    // Fallback to curve data if sliderBounds not available
    if (curveData.length > 0) {
      const prices = curveData.map((d) => d.price);
      return {
        priceMin: Math.min(...prices),
        priceMax: Math.max(...prices),
      };
    }

    return { priceMin: 0, priceMax: 100 };
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

  // State for tooltip hover
  const [hoveredPoint, setHoveredPoint] = useState<CurveDataPoint | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // SVG ref for calculating mouse positions
  const svgRef = useRef<SVGSVGElement>(null);

  // Ref for range boundary dragging
  const rangeDragRef = useRef<{
    isDragging: boolean;
    boundary: 'lower' | 'upper' | null;
    startX: number;
    startPrice: number;
  }>({
    isDragging: false,
    boundary: null,
    startX: 0,
    startPrice: 0,
  });

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

  // Range boundary drag handlers
  const handleRangeBoundaryMouseDown = useCallback(
    (boundary: 'lower' | 'upper', e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const price = boundary === 'lower' ? lowerPrice : upperPrice;
      rangeDragRef.current = {
        isDragging: true,
        boundary,
        startX: e.clientX,
        startPrice: price,
      };
      // Notify parent that user is interacting with range boundaries
      onRangeBoundaryInteraction?.();
    },
    [lowerPrice, upperPrice, onRangeBoundaryInteraction]
  );

  const handleRangeBoundaryMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!rangeDragRef.current.isDragging) return;
      const { boundary } = rangeDragRef.current;
      if (!boundary) return;

      // Calculate new price from mouse position
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;

      const mouseX = e.clientX - svgRect.left - MARGIN.left;
      const newPrice = xScale.invert(mouseX);

      // Convert to tick (with snapping)
      const tickSpacing = getTickSpacing(poolData.feeBps);
      const priceBigInt = BigInt(
        Math.floor(Math.max(0.0001, newPrice) * Number(10n ** BigInt(quoteToken.decimals)))
      );

      try {
        const newTick = priceToTick(
          priceBigInt,
          tickSpacing,
          baseToken.address,
          quoteToken.address,
          baseToken.decimals
        );

        // Apply constraints: lower < upper (with at least one tick spacing gap)
        if (boundary === 'lower') {
          const constrainedTick = Math.min(newTick, tickUpper - tickSpacing);
          onTickLowerChange?.(constrainedTick);
        } else {
          const constrainedTick = Math.max(newTick, tickLower + tickSpacing);
          onTickUpperChange?.(constrainedTick);
        }
      } catch {
        // Invalid tick calculation - ignore
      }
    },
    [xScale, poolData.feeBps, baseToken, quoteToken, tickLower, tickUpper, onTickLowerChange, onTickUpperChange]
  );

  const handleRangeBoundaryMouseUp = useCallback(() => {
    rangeDragRef.current.isDragging = false;
    rangeDragRef.current.boundary = null;
  }, []);

  // Tooltip hover handler - find closest data point to mouse X position
  const handleTooltipMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (liquidity === 0n || curveData.length === 0) {
        setHoveredPoint(null);
        setHoverX(null);
        return;
      }

      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;

      const mouseX = e.clientX - svgRect.left - MARGIN.left;

      // Check if mouse is within chart area
      if (mouseX < 0 || mouseX > chartWidth) {
        setHoveredPoint(null);
        setHoverX(null);
        return;
      }

      const priceAtMouse = xScale.invert(mouseX);

      // Find closest data point by price
      let closestPoint = curveData[0];
      let closestDistance = Math.abs(curveData[0].price - priceAtMouse);

      for (const point of curveData) {
        const distance = Math.abs(point.price - priceAtMouse);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPoint = point;
        }
      }

      setHoveredPoint(closestPoint);
      setHoverX(xScale(closestPoint.price));
    },
    [curveData, xScale, chartWidth, liquidity]
  );

  const handleTooltipMouseLeave = useCallback(() => {
    setHoveredPoint(null);
    setHoverX(null);
  }, []);

  // Attach document-level listeners for drag operations
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleXAxisMouseMove(e);
      handleYAxisMouseMove(e);
      handleChartPanMouseMove(e);
      handleRangeBoundaryMouseMove(e);
    };

    const handleMouseUp = () => {
      handleXAxisMouseUp();
      handleYAxisMouseUp();
      handleChartPanMouseUp();
      handleRangeBoundaryMouseUp();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    handleXAxisMouseMove, handleYAxisMouseMove, handleChartPanMouseMove,
    handleXAxisMouseUp, handleYAxisMouseUp, handleChartPanMouseUp,
    handleRangeBoundaryMouseMove, handleRangeBoundaryMouseUp
  ]);

  if (width < 10 || chartHeight < 10) {
    return null;
  }

  // When liquidity is 0, we still show the grid with a flat line at 0%
  const hasPosition = liquidity > 0n && curveData.length > 0;

  return (
    <svg ref={svgRef} width={width} height={height}>
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

        {/* Current price marker above x-axis */}
        {currentPrice > 0 && (
          <g pointerEvents="none">
            {/* Small vertical line upward from axis */}
            <line
              x1={xScale(currentPrice)}
              y1={chartHeight}
              x2={xScale(currentPrice)}
              y2={chartHeight - 8}
              stroke="#94a3b8"
              strokeWidth={1}
            />
            {/* Current price label (above the line, inside chart) */}
            <text
              x={xScale(currentPrice)}
              y={chartHeight - 12}
              fill="#94a3b8"
              fontSize={11}
              textAnchor="middle"
            >
              {formatCompactValue(currentPriceBigint, quoteToken.decimals)}
            </text>
          </g>
        )}

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

        {/* Clip paths for curve and area fills */}
        <defs>
          <clipPath id="pnl-curve-clip">
            <rect x={0} y={0} width={chartWidth} height={chartHeight} />
          </clipPath>
          {/* Clip for positive PnL area (above zero line) */}
          <clipPath id="pnl-positive-clip">
            <rect
              x={0}
              y={0}
              width={chartWidth}
              height={Math.max(0, Math.min(yScale(0), chartHeight))}
            />
          </clipPath>
          {/* Clip for negative PnL area (below zero line) */}
          <clipPath id="pnl-negative-clip">
            <rect
              x={0}
              y={Math.max(0, Math.min(yScale(0), chartHeight))}
              width={chartWidth}
              height={Math.max(0, chartHeight - Math.max(0, Math.min(yScale(0), chartHeight)))}
            />
          </clipPath>
        </defs>

        {/* PnL Area Fills - Green for profit, Red for loss */}
        {hasPosition && curveData.length > 0 && (
          <>
            {/* Green area for positive PnL (profit) */}
            <g clipPath="url(#pnl-positive-clip)" pointerEvents="none">
              <Area<CurveDataPoint>
                data={curveData}
                x={(d) => xScale(d.price)}
                y0={() => yScale(0)}
                y1={(d) => yScale(d.pnlPercent)}
                fill="rgba(34, 197, 94, 0.25)"
                curve={curveMonotoneX}
              />
            </g>
            {/* Red area for negative PnL (loss) */}
            <g clipPath="url(#pnl-negative-clip)" pointerEvents="none">
              <Area<CurveDataPoint>
                data={curveData}
                x={(d) => xScale(d.price)}
                y0={() => yScale(0)}
                y1={(d) => yScale(d.pnlPercent)}
                fill="rgba(239, 68, 68, 0.25)"
                curve={curveMonotoneX}
              />
            </g>
          </>
        )}

        {/* PnL Curve Line */}
        {hasPosition && curveData.length > 0 && (
          <g clipPath="url(#pnl-curve-clip)" pointerEvents="none">
            <LinePath
              data={curveData}
              x={(d) => xScale(d.price)}
              y={(d) => yScale(d.pnlPercent)}
              stroke="#ffffff"
              strokeWidth={2}
              curve={curveMonotoneX}
            />
          </g>
        )}

        {/* Current price marker on the curve */}
        {hasPosition && currentPricePnlPercent !== null && (
          <g clipPath="url(#pnl-curve-clip)" pointerEvents="none">
            <line
              x1={xScale(currentPrice)}
              y1={yScale(currentPricePnlPercent) - 8}
              x2={xScale(currentPrice)}
              y2={yScale(currentPricePnlPercent) + 8}
              stroke="#94a3b8"
              strokeWidth={2}
            />
          </g>
        )}

        {/* Range boundary markers - visual lines only (clipped) */}
        {hasPosition && (
          <>
            {/* Lower boundary - visual line */}
            <g clipPath="url(#pnl-curve-clip)" pointerEvents="none">
              <line
                x1={xScale(lowerPrice)}
                y1={0}
                x2={xScale(lowerPrice)}
                y2={chartHeight}
                stroke="#14b8a6"
                strokeWidth={2}
                strokeDasharray="4,4"
              />
            </g>
            {/* Upper boundary - visual line */}
            <g clipPath="url(#pnl-curve-clip)" pointerEvents="none">
              <line
                x1={xScale(upperPrice)}
                y1={0}
                x2={xScale(upperPrice)}
                y2={chartHeight}
                stroke="#14b8a6"
                strokeWidth={2}
                strokeDasharray="4,4"
              />
            </g>
          </>
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

        {/* Tooltip hover overlay - captures mouse events for tooltip (below range handles) */}
        <rect
          x={0}
          y={0}
          width={chartWidth}
          height={chartHeight}
          fill="transparent"
          pointerEvents="all"
          style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}
          onMouseMove={handleTooltipMouseMove}
          onMouseLeave={handleTooltipMouseLeave}
          onMouseDown={handleChartPanMouseDown}
        />

        {/* Range boundary interactive elements - ON TOP of tooltip overlay */}
        {hasPosition && (
          <>
            {/* Lower boundary - interactive hit area */}
            <rect
              x={xScale(lowerPrice) - 10}
              y={0}
              width={20}
              height={chartHeight}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => handleRangeBoundaryMouseDown('lower', e)}
            />
            {/* Lower boundary - triangle handle */}
            <polygon
              points={`${xScale(lowerPrice)},2 ${xScale(lowerPrice)},14 ${xScale(lowerPrice) + 10},8`}
              fill="#14b8a6"
              stroke="#5eead4"
              strokeWidth={1.5}
              pointerEvents="all"
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => handleRangeBoundaryMouseDown('lower', e)}
            />
            {/* Lower boundary - price label (left of triangle) */}
            <text
              x={xScale(lowerPrice) - 4}
              y={10}
              fill="#14b8a6"
              fontSize={11}
              fontWeight={500}
              textAnchor="end"
              pointerEvents="none"
            >
              {formatCompactValue(lowerPriceBigint, quoteToken.decimals)}
            </text>

            {/* Upper boundary - interactive hit area */}
            <rect
              x={xScale(upperPrice) - 10}
              y={0}
              width={20}
              height={chartHeight}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => handleRangeBoundaryMouseDown('upper', e)}
            />
            {/* Upper boundary - triangle handle */}
            <polygon
              points={`${xScale(upperPrice)},2 ${xScale(upperPrice)},14 ${xScale(upperPrice) - 10},8`}
              fill="#14b8a6"
              stroke="#5eead4"
              strokeWidth={1.5}
              pointerEvents="all"
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => handleRangeBoundaryMouseDown('upper', e)}
            />
            {/* Upper boundary - price label (right of triangle) */}
            <text
              x={xScale(upperPrice) + 4}
              y={10}
              fill="#14b8a6"
              fontSize={11}
              fontWeight={500}
              textAnchor="start"
              pointerEvents="none"
            >
              {formatCompactValue(upperPriceBigint, quoteToken.decimals)}
            </text>
          </>
        )}

        {/* Tooltip vertical line and marker - visual only, on top */}
        {hoveredPoint && hoverX !== null && (
          <>
            {/* Vertical line */}
            <line
              x1={hoverX}
              y1={0}
              x2={hoverX}
              y2={chartHeight}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="3,3"
              pointerEvents="none"
            />
            {/* Circle marker on the curve */}
            <circle
              cx={hoverX}
              cy={yScale(hoveredPoint.pnlPercent)}
              r={6}
              fill="#3b82f6"
              stroke="#fff"
              strokeWidth={2}
              pointerEvents="none"
            />
            {/* Tooltip box */}
            {(() => {
              const tooltipWidth = 180;
              const tooltipHeight = 70;
              const padding = 10;
              // Position tooltip to the right of cursor, flip if near right edge
              let tooltipX = hoverX + 15;
              if (tooltipX + tooltipWidth > chartWidth) {
                tooltipX = hoverX - tooltipWidth - 15;
              }
              // Position tooltip below cursor, flip if near bottom
              let tooltipY = yScale(hoveredPoint.pnlPercent) - tooltipHeight / 2;
              if (tooltipY < 0) tooltipY = 0;
              if (tooltipY + tooltipHeight > chartHeight) {
                tooltipY = chartHeight - tooltipHeight;
              }
              const pnlColor = hoveredPoint.pnl >= 0 ? '#22c55e' : '#ef4444';

              return (
                <g pointerEvents="none">
                  {/* Tooltip background */}
                  <rect
                    x={tooltipX}
                    y={tooltipY}
                    width={tooltipWidth}
                    height={tooltipHeight}
                    fill="#1e293b"
                    stroke="#475569"
                    strokeWidth={1}
                    rx={4}
                  />
                  {/* Price */}
                  <text
                    x={tooltipX + padding}
                    y={tooltipY + 18}
                    fill="#94a3b8"
                    fontSize={11}
                  >
                    <tspan fontWeight="500">Price:</tspan>
                    <tspan fill="#e2e8f0" dx={4}>
                      {hoveredPoint.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {quoteToken.symbol}
                    </tspan>
                  </text>
                  {/* Position Value */}
                  <text
                    x={tooltipX + padding}
                    y={tooltipY + 36}
                    fill="#94a3b8"
                    fontSize={11}
                  >
                    <tspan fontWeight="500">Position Value:</tspan>
                    <tspan fill="#e2e8f0" dx={4}>
                      {hoveredPoint.positionValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {quoteToken.symbol}
                    </tspan>
                  </text>
                  {/* PnL */}
                  <text
                    x={tooltipX + padding}
                    y={tooltipY + 54}
                    fill="#94a3b8"
                    fontSize={11}
                  >
                    <tspan fontWeight="500">PnL:</tspan>
                    <tspan fill={pnlColor} dx={4}>
                      {hoveredPoint.pnl >= 0 ? '+' : ''}{hoveredPoint.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {quoteToken.symbol} ({hoveredPoint.pnlPercent >= 0 ? '+' : ''}{hoveredPoint.pnlPercent.toFixed(2)}%)
                    </tspan>
                  </text>
                </g>
              );
            })()}
          </>
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
  height,
  className,
  ...props
}: InteractivePnLCurveProps) {
  // If height is provided, use fixed height mode; otherwise fill container
  const isResponsive = height === undefined;

  return (
    <div
      className={`w-full ${isResponsive ? 'h-full' : ''} ${className ?? ""}`}
      style={isResponsive ? undefined : { height }}
    >
      <ParentSize>
        {({ width, height: parentHeight }) => (
          <InteractivePnLCurveInner
            width={width}
            height={isResponsive ? parentHeight : height!}
            {...props}
          />
        )}
      </ParentSize>
    </div>
  );
}
