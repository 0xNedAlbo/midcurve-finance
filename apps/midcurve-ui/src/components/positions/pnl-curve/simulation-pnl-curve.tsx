/**
 * SimulationPnLCurve
 *
 * Full-size Visx PnL curve for the portfolio simulation engine.
 * Based on the InteractivePnLCurve visual patterns but tailored for simulation:
 * - Accepts pre-computed CurvePoint[] from engine.generateCurvePoints()
 * - Shows simulated price marker (purple), current pool price marker (blue)
 * - Shows trigger price lines with fired/unfired state
 * - Supports zoom (X/Y axis drag) and pan (chart area drag)
 * - No range boundary dragging, no SL/TP line dragging
 */

"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { LinePath, Area } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { formatCompactValue } from "@midcurve/shared";
import type { CurvePoint } from "@midcurve/shared";
import type { PnLCurveTokenData } from "./uniswapv3/interactive-pnl-curve";

// ============================================================================
// Types
// ============================================================================

export interface TriggerLineData {
  id: string;
  label: string;
  price: bigint;
  fired: boolean;
}

export interface SimulationPnLCurveProps {
  curvePoints: CurvePoint[];
  simulatedPrice: bigint;
  currentPoolPrice: bigint;
  lowerRangePrice: bigint;
  upperRangePrice: bigint;
  triggerLines: TriggerLineData[];
  quoteToken: PnLCurveTokenData;
  baseToken: PnLCurveTokenData;
  sliderBounds?: { min: number; max: number };
  onSliderBoundsChange?: (bounds: { min: number; max: number }) => void;
  /** Slider value 0-100 */
  sliderValue: number;
  onSliderChange: (value: number) => void;
  /** Price range for slider labels */
  sliderMinPrice: bigint;
  sliderMaxPrice: bigint;
  height?: number;
  className?: string;
}

// ============================================================================
// Internal data point (number-based for Visx scales)
// ============================================================================

interface DisplayPoint {
  price: number;
  pnlPercent: number;
  positionValue: number;
  pnlValue: number;
}

// ============================================================================
// Constants
// ============================================================================

const MARGIN = { top: 20, right: 30, bottom: 40, left: 70 };
const SLIDER_HEIGHT = 40;
const DRAG_SENSITIVITY = 50;

// ============================================================================
// Inner component (receives explicit width)
// ============================================================================

function SimulationPnLCurveInner({
  width,
  height,
  curvePoints,
  simulatedPrice,
  currentPoolPrice,
  lowerRangePrice,
  upperRangePrice,
  triggerLines,
  quoteToken,
  baseToken,
  sliderBounds,
  onSliderBoundsChange,
  sliderValue,
  onSliderChange,
  sliderMinPrice,
  sliderMaxPrice,
}: SimulationPnLCurveProps & { width: number }) {
  const svgHeight = Math.max(0, height! - SLIDER_HEIGHT);
  const chartWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const chartHeight = Math.max(0, svgHeight - MARGIN.top - MARGIN.bottom);

  const [yBounds, setYBounds] = useState({ min: -30, max: 15 });

  const quoteDecimalsDivisor = useMemo(
    () => 10n ** BigInt(quoteToken.decimals),
    [quoteToken.decimals],
  );

  // Convert bigint prices to display numbers
  const bigintToDisplay = useCallback(
    (price: bigint) => Number(price) / Number(quoteDecimalsDivisor),
    [quoteDecimalsDivisor],
  );

  const displayPriceToBigint = useCallback(
    (price: number): bigint => BigInt(Math.floor(price * Number(quoteDecimalsDivisor))),
    [quoteDecimalsDivisor],
  );

  // Convert curve points to display-space numbers
  const displayData = useMemo((): DisplayPoint[] => {
    return curvePoints
      .filter(p => p.price > 0n)
      .map(p => ({
        price: bigintToDisplay(p.price),
        pnlPercent: p.pnlPercent,
        positionValue: bigintToDisplay(p.positionValue),
        pnlValue: bigintToDisplay(p.pnlValue),
      }));
  }, [curvePoints, bigintToDisplay]);

  // Key display prices
  const currentPriceDisplay = bigintToDisplay(currentPoolPrice);
  const simulatedPriceDisplay = bigintToDisplay(simulatedPrice);
  const lowerRangeDisplay = bigintToDisplay(lowerRangePrice);
  const upperRangeDisplay = bigintToDisplay(upperRangePrice);

  // Auto-fit Y bounds on first render or when data changes significantly
  useEffect(() => {
    if (displayData.length === 0) return;
    const pnlValues = displayData.map(d => d.pnlPercent);
    const minPnl = Math.min(...pnlValues);
    const maxPnl = Math.max(...pnlValues);
    const padding = Math.max(5, (maxPnl - minPnl) * 0.2);
    setYBounds({
      min: Math.min(minPnl - padding, -5),
      max: Math.max(maxPnl + padding, 5),
    });
  }, [displayData.length > 0 ? displayData[0].price : 0, displayData.length > 0 ? displayData[displayData.length - 1].price : 0]);

  // Interpolate PnL% at current pool price
  const currentPricePnlPercent = useMemo(() => {
    if (displayData.length === 0 || currentPriceDisplay <= 0) return null;
    let lower: DisplayPoint | null = null;
    let upper: DisplayPoint | null = null;
    for (const point of displayData) {
      if (point.price <= currentPriceDisplay) {
        if (!lower || point.price > lower.price) lower = point;
      }
      if (point.price >= currentPriceDisplay) {
        if (!upper || point.price < upper.price) upper = point;
      }
    }
    if (lower && upper) {
      if (lower.price === upper.price) return lower.pnlPercent;
      const ratio = (currentPriceDisplay - lower.price) / (upper.price - lower.price);
      return lower.pnlPercent + ratio * (upper.pnlPercent - lower.pnlPercent);
    }
    return lower?.pnlPercent ?? upper?.pnlPercent ?? null;
  }, [displayData, currentPriceDisplay]);

  // Scales
  const { priceMin, priceMax } = useMemo(() => {
    if (sliderBounds && sliderBounds.min > 0 && sliderBounds.max > 0) {
      return { priceMin: sliderBounds.min, priceMax: sliderBounds.max };
    }
    if (displayData.length > 0) {
      const prices = displayData.map(d => d.price);
      return { priceMin: Math.min(...prices), priceMax: Math.max(...prices) };
    }
    return { priceMin: 0, priceMax: 100 };
  }, [displayData, sliderBounds]);

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [priceMin, priceMax], range: [0, chartWidth] }),
    [priceMin, priceMax, chartWidth],
  );

  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [yBounds.min, yBounds.max], range: [chartHeight, 0] }),
    [yBounds.min, yBounds.max, chartHeight],
  );

  // Format functions
  const formatPrice = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return value.toFixed(value < 1 ? 4 : 0);
  };
  const formatPnLPercent = (value: number) => `${value.toFixed(0)}%`;

  // ============================================================================
  // Drag handlers (zoom + pan)
  // ============================================================================

  const svgRef = useRef<SVGSVGElement>(null);

  const xDragRef = useRef<{ isDragging: boolean; startX: number; startBounds: { min: number; max: number } }>({
    isDragging: false, startX: 0, startBounds: { min: 0, max: 0 },
  });

  const yDragRef = useRef<{ isDragging: boolean; startY: number; startBounds: { min: number; max: number } }>({
    isDragging: false, startY: 0, startBounds: { min: 0, max: 0 },
  });

  const chartPanRef = useRef<{
    isDragging: boolean; startX: number; startY: number;
    startXBounds: { min: number; max: number };
    startYBounds: { min: number; max: number };
  }>({ isDragging: false, startX: 0, startY: 0, startXBounds: { min: 0, max: 0 }, startYBounds: { min: 0, max: 0 } });

  const [isPanning, setIsPanning] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<DisplayPoint | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // X-axis drag (zoom)
  const handleXAxisMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onSliderBoundsChange) return;
    e.preventDefault();
    const currentBounds = sliderBounds ?? { min: priceMin, max: priceMax };
    xDragRef.current = { isDragging: true, startX: e.clientX, startBounds: { ...currentBounds } };
  }, [sliderBounds, onSliderBoundsChange, priceMin, priceMax]);

  const handleXAxisMouseMove = useCallback((e: MouseEvent) => {
    if (!xDragRef.current.isDragging || !onSliderBoundsChange) return;
    const deltaX = e.clientX - xDragRef.current.startX;
    const zoomFactor = deltaX / DRAG_SENSITIVITY * 0.1;
    const startRange = xDragRef.current.startBounds.max - xDragRef.current.startBounds.min;
    const center = (xDragRef.current.startBounds.min + xDragRef.current.startBounds.max) / 2;
    const newRange = startRange * (1 - zoomFactor);
    const absoluteMinRange = 0.0001;
    const minRange = Math.max(absoluteMinRange, center * 0.1);
    const maxRange = Math.max(absoluteMinRange * 1000, center * 4);
    const clampedRange = Math.max(minRange, Math.min(maxRange, newRange));
    let newMin = center - clampedRange / 2;
    let newMax = center + clampedRange / 2;
    if (newMin < 0.0001) { newMin = 0.0001; newMax = newMin + clampedRange; }
    onSliderBoundsChange({ min: newMin, max: newMax });
  }, [onSliderBoundsChange]);

  const handleXAxisMouseUp = useCallback(() => { xDragRef.current.isDragging = false; }, []);

  // Y-axis drag (zoom)
  const handleYAxisMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    yDragRef.current = { isDragging: true, startY: e.clientY, startBounds: { ...yBounds } };
  }, [yBounds]);

  const handleYAxisMouseMove = useCallback((e: MouseEvent) => {
    if (!yDragRef.current.isDragging) return;
    const deltaY = e.clientY - yDragRef.current.startY;
    const zoomFactor = deltaY / DRAG_SENSITIVITY * 0.1;
    const startRange = yDragRef.current.startBounds.max - yDragRef.current.startBounds.min;
    const center = (yDragRef.current.startBounds.min + yDragRef.current.startBounds.max) / 2;
    const newRange = startRange * (1 + zoomFactor);
    const clampedRange = Math.max(20, Math.min(200, newRange));
    let newMin = center - clampedRange / 2;
    let newMax = center + clampedRange / 2;
    if (newMin > 0) { newMin = -5; newMax = newMin + clampedRange; }
    if (newMax < 0) { newMax = 5; newMin = newMax - clampedRange; }
    if (newMin < -100) { newMin = -100; newMax = newMin + clampedRange; }
    setYBounds({ min: newMin, max: newMax });
  }, []);

  const handleYAxisMouseUp = useCallback(() => { yDragRef.current.isDragging = false; }, []);

  // Chart pan
  const handleChartPanMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onSliderBoundsChange) return;
    e.preventDefault();
    e.stopPropagation();
    setIsPanning(true);
    const currentBounds = sliderBounds ?? { min: priceMin, max: priceMax };
    chartPanRef.current = {
      isDragging: true, startX: e.clientX, startY: e.clientY,
      startXBounds: { ...currentBounds }, startYBounds: { ...yBounds },
    };
  }, [sliderBounds, yBounds, onSliderBoundsChange, priceMin, priceMax]);

  const handleChartPanMouseMove = useCallback((e: MouseEvent) => {
    if (!chartPanRef.current.isDragging || !onSliderBoundsChange) return;
    const deltaX = e.clientX - chartPanRef.current.startX;
    const deltaY = e.clientY - chartPanRef.current.startY;
    const xRange = chartPanRef.current.startXBounds.max - chartPanRef.current.startXBounds.min;
    const yRange = chartPanRef.current.startYBounds.max - chartPanRef.current.startYBounds.min;
    const xShift = -(deltaX / chartWidth) * xRange;
    const yShift = (deltaY / chartHeight) * yRange;
    let newXMin = chartPanRef.current.startXBounds.min + xShift;
    let newXMax = chartPanRef.current.startXBounds.max + xShift;
    let newYMin = chartPanRef.current.startYBounds.min + yShift;
    let newYMax = chartPanRef.current.startYBounds.max + yShift;
    if (newXMin < 0.0001) { const s = 0.0001 - newXMin; newXMin = 0.0001; newXMax += s; }
    if (newYMin < -100) { const s = -100 - newYMin; newYMin = -100; newYMax += s; }
    onSliderBoundsChange({ min: newXMin, max: newXMax });
    setYBounds({ min: newYMin, max: newYMax });
  }, [chartWidth, chartHeight, onSliderBoundsChange]);

  const handleChartPanMouseUp = useCallback(() => {
    chartPanRef.current.isDragging = false;
    setIsPanning(false);
  }, []);

  // Tooltip hover
  const handleTooltipMouseMove = useCallback((e: React.MouseEvent) => {
    if (displayData.length === 0) { setHoveredPoint(null); setHoverX(null); return; }
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;
    const mouseX = e.clientX - svgRect.left - MARGIN.left;
    if (mouseX < 0 || mouseX > chartWidth) { setHoveredPoint(null); setHoverX(null); return; }
    const priceAtMouse = xScale.invert(mouseX);
    let closestPoint = displayData[0];
    let closestDist = Math.abs(displayData[0].price - priceAtMouse);
    for (const point of displayData) {
      const d = Math.abs(point.price - priceAtMouse);
      if (d < closestDist) { closestDist = d; closestPoint = point; }
    }
    setHoveredPoint(closestPoint);
    setHoverX(xScale(closestPoint.price));
  }, [displayData, xScale, chartWidth]);

  const handleTooltipMouseLeave = useCallback(() => {
    setHoveredPoint(null);
    setHoverX(null);
  }, []);

  // Document-level drag listeners
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
  }, [handleXAxisMouseMove, handleYAxisMouseMove, handleChartPanMouseMove, handleXAxisMouseUp, handleYAxisMouseUp, handleChartPanMouseUp]);

  // Format slider prices
  const formatSliderPrice = useCallback((price: bigint) => {
    const val = Number(price) / Number(quoteDecimalsDivisor);
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return val.toFixed(val < 1 ? 4 : 2);
  }, [quoteDecimalsDivisor]);

  if (width < 10 || chartHeight < 10) return null;

  const hasData = displayData.length > 0;

  // Slider range marker positions (% within slider)
  const lowerRangeSliderPct = sliderMaxPrice > sliderMinPrice
    ? Number(((lowerRangePrice - sliderMinPrice) * 100n) / (sliderMaxPrice - sliderMinPrice))
    : 0;
  const upperRangeSliderPct = sliderMaxPrice > sliderMinPrice
    ? Number(((upperRangePrice - sliderMinPrice) * 100n) / (sliderMaxPrice - sliderMinPrice))
    : 100;

  // Trigger line display positions
  const triggerDisplayLines = triggerLines.map(t => ({
    ...t,
    displayPrice: bigintToDisplay(t.price),
  }));

  return (
    <div style={{ width, height: height! }}>
    <svg ref={svgRef} width={width} height={svgHeight}>
      <rect x={0} y={0} width={width} height={svgHeight} fill="#0f172a" rx={8} ry={0} />

      <Group left={MARGIN.left} top={MARGIN.top}>
        {/* Grid */}
        <GridRows scale={yScale} width={chartWidth} stroke="#374151" strokeOpacity={0.5} strokeDasharray="3,3" numTicks={6} />
        <GridColumns scale={xScale} height={chartHeight} stroke="#374151" strokeOpacity={0.5} strokeDasharray="3,3" numTicks={6} />

        {/* Zero line */}
        {yBounds.min < 0 && yBounds.max > 0 && (
          <line x1={0} x2={chartWidth} y1={yScale(0)} y2={yScale(0)} stroke="#64748b" strokeWidth={1.5} strokeDasharray="4,4" />
        )}

        {/* X-Axis */}
        <AxisBottom
          top={chartHeight}
          scale={xScale}
          tickFormat={(v) => formatPrice(v as number)}
          stroke="#475569"
          tickStroke="#475569"
          tickLabelProps={() => ({ fill: "#94a3b8", fontSize: 11, textAnchor: "middle" as const, dy: 4 })}
          numTicks={6}
          label={`${baseToken.symbol} Price (${quoteToken.symbol})`}
          labelProps={{ fill: "#64748b", fontSize: 11, textAnchor: "middle" as const }}
          labelOffset={25}
        />

        {/* Y-Axis */}
        <AxisLeft
          scale={yScale}
          tickFormat={(v) => formatPnLPercent(v as number)}
          stroke="#475569"
          tickStroke="#475569"
          tickLabelProps={() => ({ fill: "#94a3b8", fontSize: 11, textAnchor: "end" as const, dx: -4, dy: 4 })}
          numTicks={5}
          label="PnL %"
          labelProps={{ fill: "#64748b", fontSize: 11, textAnchor: "middle" as const }}
          labelOffset={45}
        />

        {/* Clip paths */}
        <defs>
          <clipPath id="sim-curve-clip">
            <rect x={0} y={0} width={chartWidth} height={chartHeight} />
          </clipPath>
          <clipPath id="sim-positive-clip">
            <rect x={0} y={0} width={chartWidth} height={Math.max(0, Math.min(yScale(0), chartHeight))} />
          </clipPath>
          <clipPath id="sim-negative-clip">
            <rect x={0} y={Math.max(0, Math.min(yScale(0), chartHeight))} width={chartWidth}
              height={Math.max(0, chartHeight - Math.max(0, Math.min(yScale(0), chartHeight)))} />
          </clipPath>
        </defs>

        {/* PnL Area Fills */}
        {hasData && (
          <>
            <g clipPath="url(#sim-positive-clip)" pointerEvents="none">
              <Area<DisplayPoint>
                data={displayData}
                x={(d) => xScale(d.price)}
                y0={() => yScale(0)}
                y1={(d) => yScale(d.pnlPercent)}
                fill="rgba(34, 197, 94, 0.25)"
                curve={curveMonotoneX}
              />
            </g>
            <g clipPath="url(#sim-negative-clip)" pointerEvents="none">
              <Area<DisplayPoint>
                data={displayData}
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
        {hasData && (
          <g clipPath="url(#sim-curve-clip)" pointerEvents="none">
            <LinePath
              data={displayData}
              x={(d) => xScale(d.price)}
              y={(d) => yScale(d.pnlPercent)}
              stroke="#ffffff"
              strokeWidth={2}
              curve={curveMonotoneX}
            />
          </g>
        )}

        {/* Range boundary lines (cyan dashed) */}
        {hasData && (
          <g clipPath="url(#sim-curve-clip)" pointerEvents="none">
            <line x1={xScale(lowerRangeDisplay)} y1={0} x2={xScale(lowerRangeDisplay)} y2={chartHeight} stroke="#14b8a6" strokeWidth={2} strokeDasharray="4,4" />
            <line x1={xScale(upperRangeDisplay)} y1={0} x2={xScale(upperRangeDisplay)} y2={chartHeight} stroke="#14b8a6" strokeWidth={2} strokeDasharray="4,4" />
          </g>
        )}

        {/* Range boundary labels */}
        {hasData && (
          <>
            <text x={xScale(lowerRangeDisplay) - 4} y={10} fill="#14b8a6" fontSize={11} fontWeight={500} textAnchor="end" pointerEvents="none">
              {formatCompactValue(lowerRangePrice, quoteToken.decimals)}
            </text>
            <text x={xScale(upperRangeDisplay) + 4} y={10} fill="#14b8a6" fontSize={11} fontWeight={500} textAnchor="start" pointerEvents="none">
              {formatCompactValue(upperRangePrice, quoteToken.decimals)}
            </text>
          </>
        )}

        {/* Current pool price marker (blue) */}
        {hasData && currentPriceDisplay > 0 && (
          <g clipPath="url(#sim-curve-clip)" pointerEvents="none">
            <line x1={xScale(currentPriceDisplay)} y1={0} x2={xScale(currentPriceDisplay)} y2={chartHeight} stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4,4" />
            {currentPricePnlPercent !== null && (
              <circle cx={xScale(currentPriceDisplay)} cy={yScale(currentPricePnlPercent)} r={5} fill="#3b82f6" stroke="#fff" strokeWidth={1.5} />
            )}
          </g>
        )}

        {/* Current pool price label above x-axis */}
        {currentPriceDisplay > 0 && (
          <g pointerEvents="none">
            <line x1={xScale(currentPriceDisplay)} y1={chartHeight} x2={xScale(currentPriceDisplay)} y2={chartHeight - 8} stroke="#3b82f6" strokeWidth={1} />
            <text x={xScale(currentPriceDisplay)} y={chartHeight - 12} fill="#3b82f6" fontSize={10} textAnchor="middle">
              {formatCompactValue(currentPoolPrice, quoteToken.decimals)}
            </text>
          </g>
        )}

        {/* Simulated price marker (purple vertical line) */}
        {hasData && simulatedPriceDisplay > 0 && (
          <g clipPath="url(#sim-curve-clip)" pointerEvents="none">
            <line x1={xScale(simulatedPriceDisplay)} y1={0} x2={xScale(simulatedPriceDisplay)} y2={chartHeight} stroke="#a855f7" strokeWidth={2} strokeDasharray="6,3" />
          </g>
        )}

        {/* Trigger price lines (SL/TP) */}
        {hasData && triggerDisplayLines.map(trigger => (
          <g key={trigger.id} clipPath="url(#sim-curve-clip)" pointerEvents="none">
            <line
              x1={xScale(trigger.displayPrice)}
              y1={0}
              x2={xScale(trigger.displayPrice)}
              y2={chartHeight}
              stroke={trigger.id === 'stop_loss' ? '#ef4444' : '#22c55e'}
              strokeWidth={trigger.fired ? 2.5 : 2}
              strokeDasharray={trigger.fired ? 'none' : '6,4'}
              opacity={trigger.fired ? 1 : 0.7}
            />
            {/* Trigger label */}
            <text
              x={xScale(trigger.displayPrice)}
              y={trigger.id === 'stop_loss' ? chartHeight - 8 : 24}
              fill={trigger.id === 'stop_loss' ? '#ef4444' : '#22c55e'}
              fontSize={10}
              fontWeight={trigger.fired ? 700 : 500}
              textAnchor="middle"
            >
              {trigger.fired ? `${trigger.label} fired` : trigger.label}
            </text>
          </g>
        ))}

        {/* Tooltip overlay */}
        <rect
          x={0} y={0} width={chartWidth} height={chartHeight}
          fill="transparent" pointerEvents="all"
          style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}
          onMouseMove={handleTooltipMouseMove}
          onMouseLeave={handleTooltipMouseLeave}
          onMouseDown={handleChartPanMouseDown}
        />

        {/* Tooltip */}
        {hoveredPoint && hoverX !== null && (
          <>
            <line x1={hoverX} y1={0} x2={hoverX} y2={chartHeight} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3,3" pointerEvents="none" />
            <circle cx={hoverX} cy={yScale(hoveredPoint.pnlPercent)} r={6} fill="#3b82f6" stroke="#fff" strokeWidth={2} pointerEvents="none" />
            {(() => {
              const tw = 180; const th = 70; const pad = 10;
              let tx = hoverX + 15;
              if (tx + tw > chartWidth) tx = hoverX - tw - 15;
              let ty = yScale(hoveredPoint.pnlPercent) - th / 2;
              if (ty < 0) ty = 0;
              if (ty + th > chartHeight) ty = chartHeight - th;
              const pnlColor = hoveredPoint.pnlValue >= 0 ? '#22c55e' : '#ef4444';
              return (
                <g pointerEvents="none">
                  <rect x={tx} y={ty} width={tw} height={th} fill="#1e293b" stroke="#475569" strokeWidth={1} rx={4} />
                  <text x={tx + pad} y={ty + 18} fill="#94a3b8" fontSize={11}>
                    <tspan fontWeight="500">Price:</tspan>
                    <tspan fill="#e2e8f0" dx={4}>
                      {formatCompactValue(displayPriceToBigint(hoveredPoint.price), quoteToken.decimals)} {quoteToken.symbol}
                    </tspan>
                  </text>
                  <text x={tx + pad} y={ty + 36} fill="#94a3b8" fontSize={11}>
                    <tspan fontWeight="500">Value:</tspan>
                    <tspan fill="#e2e8f0" dx={4}>
                      {formatCompactValue(displayPriceToBigint(hoveredPoint.positionValue), quoteToken.decimals)} {quoteToken.symbol}
                    </tspan>
                  </text>
                  <text x={tx + pad} y={ty + 54} fill="#94a3b8" fontSize={11}>
                    <tspan fontWeight="500">PnL:</tspan>
                    <tspan fill={pnlColor} dx={4}>
                      {hoveredPoint.pnlValue >= 0 ? '+' : ''}{formatCompactValue(displayPriceToBigint(Math.abs(hoveredPoint.pnlValue)), quoteToken.decimals)} {quoteToken.symbol} ({hoveredPoint.pnlPercent >= 0 ? '+' : ''}{hoveredPoint.pnlPercent.toFixed(2)}%)
                    </tspan>
                  </text>
                </g>
              );
            })()}
          </>
        )}
      </Group>

      {/* X-axis zoom hit area */}
      <rect
        x={MARGIN.left} y={svgHeight - MARGIN.bottom} width={chartWidth} height={MARGIN.bottom}
        fill="transparent" style={{ cursor: 'ew-resize' }} onMouseDown={handleXAxisMouseDown}
      />
      {/* Y-axis zoom hit area */}
      <rect
        x={0} y={MARGIN.top} width={MARGIN.left} height={chartHeight}
        fill="transparent" style={{ cursor: 'ns-resize' }} onMouseDown={handleYAxisMouseDown}
      />
    </svg>

    {/* Slider below chart, aligned with x-axis */}
    <div
      style={{ marginLeft: MARGIN.left, marginRight: MARGIN.right, height: SLIDER_HEIGHT }}
      className="relative flex flex-col justify-center"
    >
      <input
        type="range"
        min="0"
        max="100"
        value={sliderValue}
        onChange={(e) => onSliderChange(Number(e.target.value))}
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
      <div className="relative w-full h-1 mt-0.5">
        <div
          className="absolute w-0.5 h-2 bg-cyan-400 -top-0.5"
          style={{ left: `${lowerRangeSliderPct}%` }}
          title={`Lower Range: ${formatSliderPrice(lowerRangePrice)}`}
        />
        <div
          className="absolute w-0.5 h-2 bg-cyan-400 -top-0.5"
          style={{ left: `${upperRangeSliderPct}%` }}
          title={`Upper Range: ${formatSliderPrice(upperRangePrice)}`}
        />
      </div>
      {/* Slider labels */}
      <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
        <span>{formatSliderPrice(sliderMinPrice)}</span>
        <span>{formatSliderPrice(sliderMaxPrice)}</span>
      </div>
    </div>
    </div>
  );
}

// ============================================================================
// Main component with responsive wrapper
// ============================================================================

export function SimulationPnLCurve({
  height,
  className,
  ...props
}: SimulationPnLCurveProps) {
  const totalHeight = height ? height + SLIDER_HEIGHT : undefined;
  const isResponsive = totalHeight === undefined;

  return (
    <div
      className={`w-full ${isResponsive ? 'h-full' : ''} ${className ?? ""}`}
      style={isResponsive ? undefined : { height: totalHeight }}
    >
      <ParentSize>
        {({ width, height: parentHeight }) => (
          <SimulationPnLCurveInner
            {...props}
            width={width}
            height={(totalHeight ?? parentHeight)}
          />
        )}
      </ParentSize>
    </div>
  );
}
