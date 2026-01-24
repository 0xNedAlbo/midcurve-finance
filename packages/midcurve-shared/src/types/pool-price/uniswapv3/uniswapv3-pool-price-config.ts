/**
 * Uniswap V3 Pool Price Config
 *
 * Configuration for Uniswap V3 pool price snapshots.
 * Contains immutable block information for the snapshot.
 *
 * Note: Config stays as interface (no class) since it's simple immutable data
 * with no methods beyond serialization helpers.
 */

// ============================================================================
// CONFIG INTERFACE
// ============================================================================

/**
 * Uniswap V3 Pool Price Configuration
 *
 * Immutable configuration set when price snapshot is created.
 * Contains blockchain-specific data for verification.
 */
export interface UniswapV3PoolPriceConfig {
  /**
   * Block number when price was recorded
   * @example 18000000
   */
  blockNumber: number;

  /**
   * Unix timestamp of the block (in seconds)
   * @example 1693526400
   */
  blockTimestamp: number;
}

// ============================================================================
// JSON SERIALIZATION
// ============================================================================

/**
 * JSON representation of UniswapV3PoolPriceConfig
 * No conversion needed - types are identical (no bigint fields).
 */
export interface UniswapV3PoolPriceConfigJSON {
  blockNumber: number;
  blockTimestamp: number;
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Serialize config to JSON format.
 *
 * @param config - UniswapV3PoolPriceConfig
 * @returns UniswapV3PoolPriceConfigJSON
 */
export function configToJSON(
  config: UniswapV3PoolPriceConfig
): UniswapV3PoolPriceConfigJSON {
  return { ...config };
}

/**
 * Deserialize config from JSON format.
 *
 * @param json - UniswapV3PoolPriceConfigJSON
 * @returns UniswapV3PoolPriceConfig
 */
export function configFromJSON(
  json: UniswapV3PoolPriceConfigJSON
): UniswapV3PoolPriceConfig {
  return { ...json };
}
