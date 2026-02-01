import { useEffect } from 'react';
import type { UniswapV3Pool } from '@midcurve/shared';
import { getTickSpacing } from '@midcurve/shared';

/**
 * Hook to calculate a default price range from the current pool price.
 * Default range: -20% (lower) to +10% (upper) from current price.
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

    // Tick calculations for price changes:
    // -20% price (0.8x): log1.0001(0.8) ≈ -2231 ticks
    // +10% price (1.1x): log1.0001(1.1) ≈ +953 ticks
    const TICKS_FOR_MINUS_20_PERCENT = 2231;
    const TICKS_FOR_PLUS_10_PERCENT = 953;

    // Calculate raw tick bounds
    const rawTickLower = currentTick - TICKS_FOR_MINUS_20_PERCENT;
    const rawTickUpper = currentTick + TICKS_FOR_PLUS_10_PERCENT;

    // Snap to valid tick spacing
    // Lower tick: floor to nearest tick spacing
    const tickLower = Math.floor(rawTickLower / tickSpacing) * tickSpacing;
    // Upper tick: ceil to nearest tick spacing
    const tickUpper = Math.ceil(rawTickUpper / tickSpacing) * tickSpacing;

    onRangeCalculated(tickLower, tickUpper);
  }, [discoveredPool, onRangeCalculated]);
}
