/**
 * BasicUniswapV3 Strategy State
 *
 * Mutable runtime state for the basicUniswapV3 strategy.
 */

/**
 * State for the basicUniswapV3 strategy type
 *
 * This is the mutable runtime state that gets updated as the strategy executes.
 */
export interface BasicUniswapV3StrategyState {
  /** Position ID if a position has been opened */
  positionId: string | null;

  /** NFT token ID of the Uniswap V3 position */
  nftTokenId: string | null;

  /** Last known tick of the pool */
  lastKnownTick: number | null;

  /** Whether the position is currently in range */
  isInRange: boolean;

  /** Pending action ID (if an action is being processed) */
  pendingActionId: string | null;

  /** Pending effect ID (if an effect is being executed) */
  pendingEffectId: string | null;

  /** Last error message (if any) */
  lastError: string | null;

  /** Timestamp of last successful execution */
  lastSuccessfulRunAt: number | null;
}

/**
 * Default initial state for a new basicUniswapV3 strategy
 */
export function createInitialBasicUniswapV3State(): BasicUniswapV3StrategyState {
  return {
    positionId: null,
    nftTokenId: null,
    lastKnownTick: null,
    isInRange: false,
    pendingActionId: null,
    pendingEffectId: null,
    lastError: null,
    lastSuccessfulRunAt: null,
  };
}
