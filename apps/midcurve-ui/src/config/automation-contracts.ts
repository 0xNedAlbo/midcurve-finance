/**
 * Automation Contract Configuration
 *
 * Constants for close order registration: trigger modes, swap directions, and slippage defaults.
 * Contract addresses are fetched dynamically from the API via useSharedContract hook.
 */

/**
 * Trigger modes for close orders
 */
export const TriggerMode = {
  LOWER: 0,  // Stop Loss - triggers when currentTick <= triggerTick
  UPPER: 1,  // Take Profit - triggers when currentTick >= triggerTick
} as const;

export type TriggerModeValue = typeof TriggerMode[keyof typeof TriggerMode];

/**
 * Swap directions for post-close token conversion
 */
export const SwapDirection = {
  NONE: 0,        // Keep both tokens as-is
  TOKEN0_TO_1: 1, // Swap token0 to token1
  TOKEN1_TO_0: 2, // Swap token1 to token0
} as const;

export type SwapDirectionValue = typeof SwapDirection[keyof typeof SwapDirection];

/**
 * Default slippage values for close orders
 */
export const DEFAULT_CLOSE_ORDER_SLIPPAGE = {
  liquidityBps: 50,  // 0.5% slippage for liquidity decrease
  swapBps: 100,      // 1% slippage for post-close swap
} as const;
