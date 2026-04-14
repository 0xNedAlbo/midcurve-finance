/**
 * UniswapV3VaultRangeStatus - In-range/Out-of-range badge for vault positions
 *
 * Protocol-specific component that calculates range status from ticks.
 * Uses the vault's total liquidity to determine if the position has liquidity,
 * and pool-level currentTick for range check.
 */

import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from "@midcurve/api-shared";

interface UniswapV3VaultRangeStatusProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultRangeStatus({ position }: UniswapV3VaultRangeStatusProps) {
  // Only show for active positions (archived positions show no badge)
  if (position.isArchived) return null;

  const state = position.state as UniswapV3VaultPositionStateResponse;
  const hasLiquidity = BigInt(state.liquidity || '0') > 0n;

  if (!hasLiquidity) {
    return (
      <span className="px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-medium border text-slate-400 bg-slate-500/10 border-slate-500/20">
        No Liquidity
      </span>
    );
  }

  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const poolState = position.pool.state as { currentTick: number };

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
