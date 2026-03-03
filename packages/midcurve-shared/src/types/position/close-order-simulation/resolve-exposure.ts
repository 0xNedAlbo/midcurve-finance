/**
 * Resolve Exposure Utility
 *
 * Maps SwapConfig + isToken0Quote to PostTriggerExposure semantics.
 * Shared between CloseOrderSimulationOverlay and SimulationEngine factory.
 */

import type { SwapConfig } from '../../automation/close-order-config.types.js';
import type { PostTriggerExposure } from './close-order-simulation-overlay.js';

/**
 * Resolve a SwapConfig to post-trigger exposure semantics.
 *
 * Maps SwapDirection (token0/token1 terminology) to quote/base semantics
 * using isToken0Quote:
 *
 * isToken0Quote=true  → token0=quote, token1=base:
 *   TOKEN0_TO_1 = selling quote, buying base → ALL_BASE
 *   TOKEN1_TO_0 = selling base, buying quote → ALL_QUOTE
 *
 * isToken0Quote=false → token0=base, token1=quote:
 *   TOKEN0_TO_1 = selling base, buying quote → ALL_QUOTE
 *   TOKEN1_TO_0 = selling quote, buying base → ALL_BASE
 */
export function resolveExposure(
  swapConfig: SwapConfig | null | undefined,
  isToken0Quote: boolean,
): PostTriggerExposure {
  if (!swapConfig || !swapConfig.enabled) return 'HOLD_MIXED';

  const { direction } = swapConfig;
  if (isToken0Quote) {
    return direction === 'TOKEN0_TO_1' ? 'ALL_BASE' : 'ALL_QUOTE';
  } else {
    return direction === 'TOKEN0_TO_1' ? 'ALL_QUOTE' : 'ALL_BASE';
  }
}
