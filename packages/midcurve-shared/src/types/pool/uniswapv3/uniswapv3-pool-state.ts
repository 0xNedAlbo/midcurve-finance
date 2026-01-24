/**
 * Uniswap V3 Pool State
 *
 * Mutable state for Uniswap V3 pools.
 * This state changes with swaps and liquidity updates.
 *
 * Note: State remains a plain interface (no class) because:
 * - State is stored as immutable snapshots in database
 * - No business logic on state data - just data transfer
 * - Frequent updates create new objects anyway
 */

// ============================================================================
// STATE INTERFACE
// ============================================================================

/**
 * Uniswap V3 Pool State (Mutable)
 *
 * Contains the current state of a Uniswap V3 pool.
 * Uses native bigint for type safety and calculations.
 */
export interface UniswapV3PoolState {
  /**
   * Current sqrt(price) as a Q64.96 fixed-point value
   * Range: uint160
   *
   * To calculate price:
   * price = (sqrtPriceX96 / 2^96)^2
   */
  sqrtPriceX96: bigint;

  /**
   * Current tick of the pool
   * Represents log base 1.0001 of the price
   * Range: int24 (-887272 to 887272)
   */
  currentTick: number;

  /**
   * Total liquidity currently in the pool
   * Range: uint128
   */
  liquidity: bigint;

  /**
   * Accumulated fees per unit of liquidity for token0
   * Range: uint256
   * Used to calculate fees owed to liquidity providers
   */
  feeGrowthGlobal0: bigint;

  /**
   * Accumulated fees per unit of liquidity for token1
   * Range: uint256
   * Used to calculate fees owed to liquidity providers
   */
  feeGrowthGlobal1: bigint;
}

// ============================================================================
// JSON SERIALIZATION
// ============================================================================

/**
 * JSON representation of UniswapV3PoolState
 * bigint values are serialized as strings for JSON compatibility.
 */
export interface UniswapV3PoolStateJSON {
  sqrtPriceX96: string;
  currentTick: number;
  liquidity: string;
  feeGrowthGlobal0: string;
  feeGrowthGlobal1: string;
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Serialize state to JSON format.
 * Converts bigint values to strings for JSON compatibility.
 *
 * @param state - UniswapV3PoolState with native bigint
 * @returns UniswapV3PoolStateJSON with string representations
 */
export function stateToJSON(state: UniswapV3PoolState): UniswapV3PoolStateJSON {
  return {
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    currentTick: state.currentTick,
    liquidity: state.liquidity.toString(),
    feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
    feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
  };
}

/**
 * Deserialize state from JSON format.
 * Converts string values back to native bigint.
 *
 * @param json - UniswapV3PoolStateJSON with string representations
 * @returns UniswapV3PoolState with native bigint
 */
export function stateFromJSON(json: UniswapV3PoolStateJSON): UniswapV3PoolState {
  return {
    sqrtPriceX96: BigInt(json.sqrtPriceX96),
    currentTick: json.currentTick,
    liquidity: BigInt(json.liquidity),
    feeGrowthGlobal0: BigInt(json.feeGrowthGlobal0),
    feeGrowthGlobal1: BigInt(json.feeGrowthGlobal1),
  };
}
