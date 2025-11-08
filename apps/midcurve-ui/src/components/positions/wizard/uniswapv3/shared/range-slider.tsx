"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { formatCompactValue } from "@/lib/fraction-format";

interface SliderBounds {
  min: number;
  max: number;
}

interface RangeSliderProps {
  currentPrice: number;
  lowerPrice: number;
  upperPrice: number;
  onRangeChange: (_lowerPrice: number, _upperPrice: number) => void;
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
  aprValue?: string;
  aprLoading?: boolean;
  className?: string;
  sliderBounds?: SliderBounds;
  onBoundsChange?: (_bounds: SliderBounds) => void;
}

const PRESET_PERCENTAGES = [5, 10, 20, 30, 40, 50];
const DEFAULT_RANGE_PERCENT = 50; // ±50% default range

export function RangeSlider({
  currentPrice,
  lowerPrice,
  upperPrice,
  onRangeChange,
  quoteTokenSymbol,
  quoteTokenDecimals,
  aprValue,
  aprLoading = false,
  className = "",
  sliderBounds: externalSliderBounds,
  onBoundsChange,
}: RangeSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<
    "lower" | "upper" | "range" | null
  >(null);
  const [localDragState, setLocalDragState] = useState<{
    lowerPrice: number | null;
    upperPrice: number | null;
  }>({ lowerPrice: null, upperPrice: null });
  const [rangeDragStart, setRangeDragStart] = useState<{
    mouseX: number;
    initialLowerPrice: number;
    initialUpperPrice: number;
  } | null>(null);
  const [internalSliderBounds, setInternalSliderBounds] = useState(() => ({
    min: currentPrice * (1 - DEFAULT_RANGE_PERCENT / 100),
    max: currentPrice * (1 + DEFAULT_RANGE_PERCENT / 100),
  }));

  // Use external bounds if provided, otherwise use internal
  const sliderBounds = externalSliderBounds || internalSliderBounds;
  const setSliderBounds = onBoundsChange || setInternalSliderBounds;

  // Update slider bounds when current price changes (only if using internal bounds)
  useEffect(() => {
    if (!externalSliderBounds) {
      setInternalSliderBounds({
        min: currentPrice * (1 - DEFAULT_RANGE_PERCENT / 100),
        max: currentPrice * (1 + DEFAULT_RANGE_PERCENT / 100),
      });
    }
  }, [currentPrice, externalSliderBounds]);

  // Calculate positions as percentages - use local drag state during dragging
  const currentPricePercent = useMemo(() => {
    return (
      ((currentPrice - sliderBounds.min) /
        (sliderBounds.max - sliderBounds.min)) *
      100
    );
  }, [currentPrice, sliderBounds]);

  const effectiveLowerPrice = localDragState.lowerPrice ?? lowerPrice;
  const effectiveUpperPrice = localDragState.upperPrice ?? upperPrice;

  const lowerPricePercent = useMemo(() => {
    return (
      ((effectiveLowerPrice - sliderBounds.min) /
        (sliderBounds.max - sliderBounds.min)) *
      100
    );
  }, [effectiveLowerPrice, sliderBounds]);

  const upperPricePercent = useMemo(() => {
    return (
      ((effectiveUpperPrice - sliderBounds.min) /
        (sliderBounds.max - sliderBounds.min)) *
      100
    );
  }, [effectiveUpperPrice, sliderBounds]);

  // Convert percentage to price
  const percentToPrice = useCallback(
    (percent: number) => {
      return (
        sliderBounds.min +
        (percent / 100) * (sliderBounds.max - sliderBounds.min)
      );
    },
    [sliderBounds]
  );

  // Handle mouse events for dragging
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: "lower" | "upper") => {
      e.preventDefault();
      setIsDragging(handle);
    },
    []
  );

  // Handle range dragging (drag the fill area to move entire range)
  const handleRangeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging("range");
      setRangeDragStart({
        mouseX: e.clientX,
        initialLowerPrice: effectiveLowerPrice,
        initialUpperPrice: effectiveUpperPrice,
      });
    },
    [effectiveLowerPrice, effectiveUpperPrice]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !sliderRef.current) return;

      if (isDragging === "range" && rangeDragStart) {
        // Range dragging: move both handles together maintaining distance
        const deltaX = e.clientX - rangeDragStart.mouseX;
        const rect = sliderRef.current.getBoundingClientRect();
        const deltaPercent = (deltaX / rect.width) * 100;
        const deltaPriceRange =
          (sliderBounds.max - sliderBounds.min) * (deltaPercent / 100);

        const newLowerPrice = rangeDragStart.initialLowerPrice + deltaPriceRange;
        const newUpperPrice = rangeDragStart.initialUpperPrice + deltaPriceRange;

        // Check bounds to prevent moving outside slider bounds
        if (
          newLowerPrice >= sliderBounds.min &&
          newUpperPrice <= sliderBounds.max
        ) {
          setLocalDragState({
            lowerPrice: newLowerPrice,
            upperPrice: newUpperPrice,
          });
        }
      } else {
        // Individual handle dragging
        const rect = sliderRef.current.getBoundingClientRect();
        const percent = Math.min(
          100,
          Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)
        );
        const newPrice = percentToPrice(percent);

        // Update local state during dragging - don't bubble up yet
        if (isDragging === "lower" && newPrice < effectiveUpperPrice) {
          setLocalDragState((prev) => ({ ...prev, lowerPrice: newPrice }));
        } else if (isDragging === "upper" && newPrice > effectiveLowerPrice) {
          setLocalDragState((prev) => ({ ...prev, upperPrice: newPrice }));
        }
      }
    },
    [
      isDragging,
      effectiveUpperPrice,
      effectiveLowerPrice,
      percentToPrice,
      rangeDragStart,
      sliderBounds,
    ]
  );

  const handleMouseUp = useCallback(() => {
    // Bubble up final values if we have local drag state
    if (
      localDragState.lowerPrice !== null ||
      localDragState.upperPrice !== null
    ) {
      const finalLowerPrice = localDragState.lowerPrice ?? lowerPrice;
      const finalUpperPrice = localDragState.upperPrice ?? upperPrice;
      onRangeChange(finalLowerPrice, finalUpperPrice);
    }

    // Clear dragging state but keep local state for optimistic updates
    setIsDragging(null);
    setRangeDragStart(null);
    // Note: We don't clear localDragState here - it will be cleared when props sync
  }, [localDragState, lowerPrice, upperPrice, onRangeChange]);

  // Add global mouse event listeners during drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Clear local state when props have synced (optimistic updates)
  useEffect(() => {
    if (
      localDragState.lowerPrice !== null ||
      localDragState.upperPrice !== null
    ) {
      const tolerance = 0.001; // Small tolerance for floating point comparison
      const lowerMatches =
        localDragState.lowerPrice === null ||
        Math.abs(lowerPrice - localDragState.lowerPrice) < tolerance;
      const upperMatches =
        localDragState.upperPrice === null ||
        Math.abs(upperPrice - localDragState.upperPrice) < tolerance;

      // Clear local state when props have caught up to our local values
      if (lowerMatches && upperMatches) {
        setLocalDragState({ lowerPrice: null, upperPrice: null });
      }
    }
  }, [lowerPrice, upperPrice, localDragState]);

  // Handle preset buttons
  const handlePresetClick = useCallback(
    (percentage: number) => {
      const range = currentPrice * (percentage / 100);
      const newLowerPrice = currentPrice - range;
      const newUpperPrice = currentPrice + range;

      // Clear any local drag state that might be overriding the props
      setLocalDragState({ lowerPrice: null, upperPrice: null });

      // Always reset slider boundaries to default setting (±50% of current price)
      // But ensure they're at least wide enough to contain the preset range
      const DEFAULT_RANGE_PERCENT = 50;
      const minBoundaryPercent = Math.max(DEFAULT_RANGE_PERCENT, percentage + 10); // At least 10% margin around preset

      const newSliderBounds = {
        min: Math.max(
          0.01,
          currentPrice * (1 - minBoundaryPercent / 100)
        ),
        max: currentPrice * (1 + minBoundaryPercent / 100),
      };

      // Set bounds first to ensure they're ready when the range updates
      setSliderBounds(newSliderBounds);

      // Then update the position range
      onRangeChange(newLowerPrice, newUpperPrice);
    },
    [currentPrice, onRangeChange, setSliderBounds]
  );

  const handleMaxClick = useCallback(() => {
    onRangeChange(sliderBounds.min, sliderBounds.max);
  }, [sliderBounds, onRangeChange]);

  // Handle zoom in/out functionality
  // TODO: BUGGY - Zoom logic fails in extreme cases (over-zooming in/out). Works for reasonable usage ranges.
  // Needs revisit to handle edge cases properly.
  const handleZoom = useCallback(
    (direction: "in" | "out", shiftKey: boolean = false) => {
      const zoomMultiplier = shiftKey ? 10 : 1;
      const zoomPercent = 1 * zoomMultiplier; // 1% per step, 10% with shift
      const expansion = currentPrice * (zoomPercent / 100);

      if (direction === "out") {
        // onZoomOut => Expand slider boundaries outward
        let newSliderMin = sliderBounds.min - expansion;
        if (newSliderMin <= 0) {
          newSliderMin = 0.01; // Keep a small positive value to prevent PnL curve errors
        }
        const newSliderMax = sliderBounds.max + expansion;

        setSliderBounds({ min: newSliderMin, max: newSliderMax });
      } else {
        // onZoomIn => Slider boundaries cannot shrink more than position range
        let newSliderMin = sliderBounds.min + expansion;
        if (newSliderMin > lowerPrice || zoomPercent > 100) {
          newSliderMin = lowerPrice;
        }

        let newSliderMax = sliderBounds.max - expansion;
        if (newSliderMax < upperPrice) {
          newSliderMax = upperPrice;
        }

        setSliderBounds({ min: newSliderMin, max: newSliderMax });
      }
    },
    [currentPrice, sliderBounds, setSliderBounds, lowerPrice, upperPrice]
  );

  // Format prices for display
  const formatPrice = useCallback(
    (price: number) => {
      const priceBigInt = BigInt(
        Math.floor(price * Number(10n ** BigInt(quoteTokenDecimals)))
      );
      return formatCompactValue(priceBigInt, quoteTokenDecimals);
    },
    [quoteTokenDecimals]
  );

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Price Display */}
      <div className="flex justify-between items-center text-sm">
        <div className="text-slate-300">
          <span className="font-mono">{formatPrice(effectiveLowerPrice)}</span>
          <span className="text-slate-500 ml-1">{quoteTokenSymbol}</span>
        </div>
        <div className="text-center">
          <div className="text-yellow-400 font-medium">
            <span className="font-mono">{formatPrice(currentPrice)}</span>
            <span className="text-yellow-300 ml-1">{quoteTokenSymbol}</span>
          </div>
          <div className="text-xs text-slate-400">Current</div>
        </div>
        <div className="text-slate-300">
          <span className="font-mono">{formatPrice(effectiveUpperPrice)}</span>
          <span className="text-slate-500 ml-1">{quoteTokenSymbol}</span>
        </div>
      </div>

      {/* Slider Container */}
      <div className="flex items-center gap-3">
        {/* Zoom In Control */}
        <div className="flex justify-center">
          <button
            onClick={(e) => handleZoom("in", e.shiftKey)}
            className="p-2 bg-slate-700/80 backdrop-blur-sm border border-slate-600 rounded text-slate-300 hover:text-white hover:bg-slate-600/80 transition-colors cursor-pointer"
            title="Zoom in - shrink boundaries (Shift: 10x faster)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* Slider Track */}
        <div className="flex-1 relative">
          <div
            ref={sliderRef}
            className="relative h-6 bg-slate-700/50 rounded-full border border-slate-600/50 cursor-pointer"
          >
            {/* Track Fill - draggable to move entire range */}
            <div
              className={`absolute top-0 h-full bg-blue-500/30 rounded-full border border-blue-400/50 cursor-grab ${
                isDragging === "range"
                  ? "cursor-grabbing bg-blue-500/40"
                  : "hover:bg-blue-500/40"
              } transition-colors`}
              style={{
                left: `${Math.min(lowerPricePercent, upperPricePercent)}%`,
                width: `${Math.abs(upperPricePercent - lowerPricePercent)}%`,
              }}
              onMouseDown={handleRangeMouseDown}
              title="Drag to move entire range"
            />

            {/* Current Price Indicator */}
            <div
              className="absolute top-0 w-0.5 h-full bg-yellow-400"
              style={{ left: `${currentPricePercent}%` }}
            />

            {/* Lower Handle */}
            <div
              className={`absolute w-5 h-5 bg-blue-500 border-2 border-slate-800 rounded-full cursor-grab transform -translate-x-1/2 -translate-y-0.5 ${
                isDragging === "lower"
                  ? "scale-110 cursor-grabbing"
                  : "hover:scale-105"
              } transition-transform`}
              style={{ left: `${lowerPricePercent}%`, top: "50%" }}
              onMouseDown={(e) => handleMouseDown(e, "lower")}
            />

            {/* Upper Handle */}
            <div
              className={`absolute w-5 h-5 bg-blue-500 border-2 border-slate-800 rounded-full cursor-grab transform -translate-x-1/2 -translate-y-0.5 ${
                isDragging === "upper"
                  ? "scale-110 cursor-grabbing"
                  : "hover:scale-105"
              } transition-transform`}
              style={{ left: `${upperPricePercent}%`, top: "50%" }}
              onMouseDown={(e) => handleMouseDown(e, "upper")}
            />
          </div>
        </div>

        {/* Zoom Out Control */}
        <div className="flex justify-center">
          <button
            onClick={(e) => handleZoom("out", e.shiftKey)}
            className="p-2 bg-slate-700/80 backdrop-blur-sm border border-slate-600 rounded text-slate-300 hover:text-white hover:bg-slate-600/80 transition-colors cursor-pointer"
            title="Zoom out - expand boundaries (Shift: 10x faster)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Preset Buttons and APR - aligned with slider track */}
      <div
        className="flex items-center justify-between"
        style={{ marginLeft: "56px", marginRight: "56px" }}
      >
        <div className="flex flex-wrap gap-2">
          {PRESET_PERCENTAGES.map((percentage) => (
            <button
              key={percentage}
              onClick={() => handlePresetClick(percentage)}
              className="px-3 py-1.5 bg-blue-600/20 backdrop-blur-sm border border-blue-500/30 rounded-lg text-blue-300 text-sm hover:bg-blue-600/30 hover:text-blue-200 transition-colors cursor-pointer"
            >
              ±{percentage}%
            </button>
          ))}
          <button
            onClick={handleMaxClick}
            className="px-3 py-1.5 bg-blue-600/20 backdrop-blur-sm border border-blue-500/30 rounded-lg text-blue-300 text-sm hover:bg-blue-600/30 hover:text-blue-200 transition-colors cursor-pointer"
          >
            Max
          </button>
        </div>

        {/* APR Display */}
        <div className="text-yellow-400 font-bold text-sm">
          APR: {aprLoading ? "—" : aprValue || "—"}%
        </div>
      </div>
    </div>
  );
}
