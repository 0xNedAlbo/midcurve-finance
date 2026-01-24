/**
 * Uniswap V3 Pool Price State
 *
 * State for Uniswap V3 pool price snapshots.
 * Contains the pool's pricing state at the time of the snapshot.
 *
 * Note: State stays as interface (no class) since it's immutable snapshot data
 * with no business logic - just data transfer.
 */

// ============================================================================
// STATE INTERFACE
// ============================================================================

/**
 * Uniswap V3 Pool Price State
 *
 * Contains the pool's pricing state at snapshot time.
 * Uses native bigint for type safety and calculations.
 */
export interface UniswapV3PoolPriceState {
  /**
   * Current sqrt(price) as a Q64.96 fixed-point value
   * Range: uint160
   *
   * To calculate price:
   * price = (sqrtPriceX96 / 2^96)^2
   */
  sqrtPriceX96: bigint;

  /**
   * Current tick at snapshot time
   * Represents log base 1.0001 of the price
   * Range: int24 (-887272 to 887272)
   */
  tick: number;
}

// ============================================================================
// JSON SERIALIZATION
// ============================================================================

/**
 * JSON representation of UniswapV3PoolPriceState
 * bigint values are serialized as strings for JSON compatibility.
 */
export interface UniswapV3PoolPriceStateJSON {
  sqrtPriceX96: string;
  tick: number;
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Serialize state to JSON format.
 * Converts bigint values to strings for JSON compatibility.
 *
 * @param state - UniswapV3PoolPriceState with native bigint
 * @returns UniswapV3PoolPriceStateJSON with string representations
 */
export function priceStateToJSON(
  state: UniswapV3PoolPriceState
): UniswapV3PoolPriceStateJSON {
  return {
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    tick: state.tick,
  };
}

/**
 * Deserialize state from JSON format.
 * Converts string values back to native bigint.
 *
 * @param json - UniswapV3PoolPriceStateJSON with string representations
 * @returns UniswapV3PoolPriceState with native bigint
 */
export function priceStateFromJSON(
  json: UniswapV3PoolPriceStateJSON
): UniswapV3PoolPriceState {
  return {
    sqrtPriceX96: BigInt(json.sqrtPriceX96),
    tick: json.tick,
  };
}
