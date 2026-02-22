/**
 * Close Order Config Types
 *
 * Protocol-agnostic type definitions for trigger mode, swap direction, and swap config.
 * These concepts apply to any concentrated liquidity protocol, not just UniswapV3.
 */

/**
 * Trigger mode for price-based closing
 *
 * - LOWER: Trigger when price falls below threshold
 * - UPPER: Trigger when price rises above threshold
 */
export type TriggerMode = 'LOWER' | 'UPPER';

/**
 * Swap direction for post-close token conversion
 *
 * Uses the pool's native token ordering (token0/token1), role-agnostic.
 * - TOKEN0_TO_1: Swap token0 to token1
 * - TOKEN1_TO_0: Swap token1 to token0
 */
export type SwapDirection = 'TOKEN0_TO_1' | 'TOKEN1_TO_0';

/**
 * Optional swap configuration for post-close token conversion
 */
export interface SwapConfig {
  /**
   * Whether swap is enabled
   */
  enabled: boolean;

  /**
   * Direction of swap (TOKEN0_TO_1 or TOKEN1_TO_0)
   */
  direction: SwapDirection;

  /**
   * Slippage tolerance in basis points (0-10000)
   */
  slippageBps: number;
}
