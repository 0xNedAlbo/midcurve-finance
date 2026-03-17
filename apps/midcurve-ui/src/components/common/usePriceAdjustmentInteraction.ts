/**
 * usePriceAdjustmentInteraction Hook
 *
 * Manages the interaction state for manual price adjustment:
 * - isRecalculating: shows spinner for minimum 1s feedback
 * - hasAdjusted: tracks whether user has adjusted at least once
 * - handleAdjust: triggers refresh + baseline reset with min 1s delay
 *
 * Used by both create position and increase deposit wizards.
 */

import { useState, useCallback } from 'react';
import type { UsePriceAdjustmentReturn } from '@/components/positions/wizard/create-position/uniswapv3/hooks/usePriceAdjustment';

export interface UsePriceAdjustmentInteractionReturn {
  isRecalculating: boolean;
  hasAdjusted: boolean;
  handleAdjust: () => Promise<void>;
}

export function usePriceAdjustmentInteraction(
  priceAdjustment: UsePriceAdjustmentReturn
): UsePriceAdjustmentInteractionReturn {
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [hasAdjusted, setHasAdjusted] = useState(false);

  const handleAdjust = useCallback(async () => {
    setIsRecalculating(true);
    const minDelay = new Promise(resolve => setTimeout(resolve, 1000));
    const refreshPromise = priceAdjustment.refresh();
    await Promise.all([minDelay, refreshPromise]);
    priceAdjustment.resetBaseline();
    setIsRecalculating(false);
    setHasAdjusted(true);
  }, [priceAdjustment]);

  return { isRecalculating, hasAdjusted, handleAdjust };
}
