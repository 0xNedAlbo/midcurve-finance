/**
 * UniswapV3RangeStatus - In-range/Out-of-range badge for Uniswap V3 positions
 *
 * Protocol-specific component that calculates range status from ticks.
 */

import type { ListPositionData } from "@midcurve/api-shared";

interface UniswapV3RangeStatusProps {
  position: ListPositionData;
}

export function UniswapV3RangeStatus({ position }: UniswapV3RangeStatusProps) {
  // Only show for active positions
  if (!position.isActive) return null;

  const config = position.config as {
    tickLower: number;
    tickUpper: number;
  };
  const poolState = position.pool.state as {
    currentTick: number;
  };

  const isInRange =
    poolState.currentTick >= config.tickLower &&
    poolState.currentTick <= config.tickUpper;

  const rangeColor = isInRange
    ? "text-green-400 bg-green-500/10 border-green-500/20"
    : "text-red-400 bg-red-500/10 border-red-500/20";

  return (
    <span className={`px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-medium border ${rangeColor}`}>
      {isInRange ? "In Range" : "Out of Range"}
    </span>
  );
}
