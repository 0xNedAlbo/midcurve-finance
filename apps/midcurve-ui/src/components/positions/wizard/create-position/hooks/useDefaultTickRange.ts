import { useEffect } from 'react';
import type { UniswapV3Pool } from '@midcurve/shared';
import { getTickSpacing } from '@midcurve/shared';

/**
 * Hook to calculate a default ±20% price range from the current pool price.
 * This default is used for capital allocation calculations before the user
 * configures their desired range in the Range step.
 *
 * The range is snapped to valid tick boundaries based on the pool's fee tier.
 */
export function useDefaultTickRange(
  discoveredPool: UniswapV3Pool | null,
  onRangeCalculated: (tickLower: number, tickUpper: number) => void
) {
  useEffect(() => {
    if (!discoveredPool) return;

    const currentTick = discoveredPool.state.currentTick as number;
    const tickSpacing = getTickSpacing(discoveredPool.feeBps);

    // ±20% price change corresponds to approximately ±1823 ticks
    // log1.0001(1.2) ≈ 1823
    // log1.0001(0.8) ≈ -2231 (but we use symmetric for simplicity)
    const TICKS_FOR_20_PERCENT = 1823;

    // Calculate raw tick bounds
    const rawTickLower = currentTick - TICKS_FOR_20_PERCENT;
    const rawTickUpper = currentTick + TICKS_FOR_20_PERCENT;

    // Snap to valid tick spacing
    // Lower tick: floor to nearest tick spacing
    const tickLower = Math.floor(rawTickLower / tickSpacing) * tickSpacing;
    // Upper tick: ceil to nearest tick spacing
    const tickUpper = Math.ceil(rawTickUpper / tickSpacing) * tickSpacing;

    onRangeCalculated(tickLower, tickUpper);
  }, [discoveredPool, onRangeCalculated]);
}
