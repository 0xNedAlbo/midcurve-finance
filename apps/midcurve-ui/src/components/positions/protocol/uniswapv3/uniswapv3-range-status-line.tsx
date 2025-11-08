/**
 * UniswapV3RangeStatusLine - Visual representation of position range vs current price
 *
 * Displays a horizontal line with:
 * - Lower price marker (below line)
 * - Upper price marker (below line)
 * - Current price marker (above line, color-coded)
 * - Distance percentages
 */

"use client";

import { formatCompactValue } from "@/lib/fraction-format";
import { tickToPrice } from "@midcurve/shared";

interface Position {
  isToken0Quote: boolean;
  isActive: boolean;
  config: {
    tickLower: number;
    tickUpper: number;
  };
  pool: {
    token0: {
      config: { address: string };
      decimals: number;
      symbol: string;
    };
    token1: {
      config: { address: string };
      decimals: number;
      symbol: string;
    };
    state: {
      currentTick: number;
      currentPrice: string;
    };
  };
}

interface UniswapV3RangeStatusLineProps {
  position: Position;
}

export function UniswapV3RangeStatusLine({
  position,
}: UniswapV3RangeStatusLineProps) {
  const { pool } = position;

  // Determine base and quote tokens
  const baseToken = position.isToken0Quote ? pool.token1 : pool.token0;
  const quoteToken = position.isToken0Quote ? pool.token0 : pool.token1;

  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Calculate prices from ticks
  const lowerPrice = tickToPrice(
    position.config.tickLower,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    Number(baseToken.decimals)
  );

  const upperPrice = tickToPrice(
    position.config.tickUpper,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    Number(baseToken.decimals)
  );

  // Calculate current price from current tick (only for active positions)
  let currentTick: number | null = null;
  let currentPrice: bigint | null = null;
  let isInRange = false;
  let isBelowRange = false;
  let distanceToLower = "";
  let distanceToUpper = "";
  let formattedCurrentPrice = "";
  let currentPosition = 50;
  let currentAlignment: "left" | "center" | "right" = "center";

  if (position.isActive) {
    currentTick = pool.state.currentTick;
    currentPrice = tickToPrice(
      currentTick,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      Number(baseToken.decimals)
    );

    // Determine if position is in range
    isInRange =
      currentTick >= position.config.tickLower &&
      currentTick <= position.config.tickUpper;
    isBelowRange = currentTick < position.config.tickLower;

    // Calculate percentage distance from current price to other prices
    const calculatePercentageDistance = (
      fromPrice: bigint,
      toPrice: bigint
    ): string => {
      if (fromPrice === 0n) return "0";

      const difference = toPrice - fromPrice;
      const percentage = (Number(difference) * 100) / Number(fromPrice);

      const sign = percentage > 0 ? "+" : "";
      return `${sign}${percentage.toFixed(1)}%`;
    };

    distanceToLower = calculatePercentageDistance(currentPrice, lowerPrice);
    distanceToUpper = calculatePercentageDistance(currentPrice, upperPrice);

    // Format current price for display
    formattedCurrentPrice = formatCompactValue(
      currentPrice,
      Number(quoteToken.decimals)
    );

    // Calculate positions using linear price scale
    // Range always occupies center 60% (20%-80%)
    const rangeWidth = upperPrice - lowerPrice;
    const fullDisplayRange = (rangeWidth * 5n) / 3n; // range / 0.6 = range * 5/3
    const leftEdgePrice = lowerPrice - rangeWidth / 3n;

    // Calculate position on linear scale
    const calculatePosition = (price: bigint): number => {
      if (fullDisplayRange === 0n) return 50;

      const offset = price - leftEdgePrice;
      const position = (Number(offset) * 100) / Number(fullDisplayRange);

      // Clamp to 0-100% range
      return Math.max(0, Math.min(100, position));
    };

    currentPosition = calculatePosition(currentPrice);

    // Helper function to determine label alignment
    const getLabelAlignment = (
      position: number
    ): "left" | "center" | "right" => {
      if (position <= 15) return "left";
      if (position >= 85) return "right";
      return "center";
    };

    currentAlignment = getLabelAlignment(currentPosition);
  }

  // Format prices for display (always needed)
  const formattedLowerPrice = formatCompactValue(
    lowerPrice,
    Number(quoteToken.decimals)
  );
  const formattedUpperPrice = formatCompactValue(
    upperPrice,
    Number(quoteToken.decimals)
  );

  // Fixed positions for range boundaries
  const lowerPosition = 20; // Always at 20%
  const upperPosition = 80; // Always at 80%

  // Helper function to determine label alignment
  const getLabelAlignment = (
    position: number
  ): "left" | "center" | "right" => {
    if (position <= 15) return "left";
    if (position >= 85) return "right";
    return "center";
  };

  const lowerAlignment = getLabelAlignment(lowerPosition);
  const upperAlignment = getLabelAlignment(upperPosition);

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      <div className="relative h-28 py-4">
        {/* Horizontal line */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-600" />

        {/* Lower Price - Below Line */}
        <div
          className="absolute top-1/2"
          style={{
            left: `${lowerPosition}%`,
            transform:
              lowerAlignment === "left"
                ? "translateX(0)"
                : lowerAlignment === "right"
                ? "translateX(-100%)"
                : "translateX(-50%)",
          }}
        >
          {/* Scale Marker */}
          <div
            className="absolute -top-3 text-white text-lg font-bold"
            style={{
              left:
                lowerAlignment === "left"
                  ? "0"
                  : lowerAlignment === "right"
                  ? "auto"
                  : "50%",
              right: lowerAlignment === "right" ? "0" : "auto",
              transform: lowerAlignment === "center" ? "translateX(-50%)" : "none",
            }}
          >
            |
          </div>
          {/* Label Below */}
          <div
            className="flex flex-col px-2 pt-3"
            style={{
              alignItems:
                lowerAlignment === "left"
                  ? "flex-start"
                  : lowerAlignment === "right"
                  ? "flex-end"
                  : "center",
            }}
          >
            <div className="text-sm font-medium text-white whitespace-nowrap">
              {formattedLowerPrice} {quoteToken.symbol}
            </div>
            <div className="text-xs text-slate-400 whitespace-nowrap">
              Lower Price
            </div>
          </div>
        </div>

        {/* Upper Price - Below Line */}
        <div
          className="absolute top-1/2"
          style={{
            left: `${upperPosition}%`,
            transform:
              upperAlignment === "left"
                ? "translateX(0)"
                : upperAlignment === "right"
                ? "translateX(-100%)"
                : "translateX(-50%)",
          }}
        >
          {/* Scale Marker */}
          <div
            className="absolute -top-3 text-white text-lg font-bold"
            style={{
              left:
                upperAlignment === "left"
                  ? "0"
                  : upperAlignment === "right"
                  ? "auto"
                  : "50%",
              right: upperAlignment === "right" ? "0" : "auto",
              transform: upperAlignment === "center" ? "translateX(-50%)" : "none",
            }}
          >
            |
          </div>
          {/* Label Below */}
          <div
            className="flex flex-col px-2 pt-3"
            style={{
              alignItems:
                upperAlignment === "left"
                  ? "flex-start"
                  : upperAlignment === "right"
                  ? "flex-end"
                  : "center",
            }}
          >
            <div className="text-sm font-medium text-white whitespace-nowrap">
              {formattedUpperPrice} {quoteToken.symbol}
            </div>
            <div className="text-xs text-slate-400 whitespace-nowrap">
              Upper Price
            </div>
          </div>
        </div>

        {/* Current Price - Above Line (only for active positions) */}
        {position.isActive ? (
          <div
            className="absolute top-1/2"
            style={{
              left: `${currentPosition}%`,
              transform:
                currentAlignment === "left"
                  ? "translateX(0)"
                  : currentAlignment === "right"
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
            }}
          >
            {/* Label Above */}
            <div
              className="flex flex-col px-3 absolute bottom-3"
              style={{
                left:
                  currentAlignment === "left"
                    ? "0"
                    : currentAlignment === "right"
                    ? "auto"
                    : "50%",
                right: currentAlignment === "right" ? "0" : "auto",
                transform:
                  currentAlignment === "center" ? "translateX(-50%)" : "none",
                alignItems:
                  currentAlignment === "left"
                    ? "flex-start"
                    : currentAlignment === "right"
                    ? "flex-end"
                    : "center",
              }}
            >
              <div
                className={`text-sm font-medium whitespace-nowrap ${
                  isInRange ? "text-green-400" : "text-red-400"
                }`}
              >
                {formattedCurrentPrice} {quoteToken.symbol}
              </div>
              <div
                className={`text-xs whitespace-nowrap ${
                  isInRange ? "text-green-400" : "text-red-400"
                }`}
              >
                Current Price
              </div>
              <div className="text-xs text-slate-400 mt-0.5 whitespace-nowrap">
                {isInRange
                  ? `${distanceToLower} to lower • ${distanceToUpper} to upper`
                  : isBelowRange
                  ? `${distanceToLower} to lower`
                  : `${distanceToUpper} to upper`}
              </div>
            </div>
            {/* Scale Marker - Colored */}
            <div
              className={`absolute -top-3 text-lg font-bold ${
                isInRange ? "text-green-400" : "text-red-400"
              }`}
              style={{
                left:
                  currentAlignment === "left"
                    ? "0"
                    : currentAlignment === "right"
                    ? "auto"
                    : "50%",
                right: currentAlignment === "right" ? "0" : "auto",
                transform:
                  currentAlignment === "center" ? "translateX(-50%)" : "none",
              }}
            >
              |
            </div>
          </div>
        ) : (
          /* Position Closed Badge - Centered Above Line */
          <div
            className="absolute top-1/2"
            style={{
              left: "50%",
              transform: "translateX(-50%)",
            }}
          >
            <div
              className="flex flex-col items-center px-3 absolute bottom-3"
              style={{
                left: "50%",
                transform: "translateX(-50%)",
              }}
            >
              <div className="px-3 py-1 bg-slate-700/50 border border-slate-600/50 rounded-lg">
                <div className="text-sm font-medium text-slate-400 whitespace-nowrap">
                  Position Closed
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
