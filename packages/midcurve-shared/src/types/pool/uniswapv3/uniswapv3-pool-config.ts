/**
 * Uniswap V3 Pool Configuration
 *
 * Immutable configuration for Uniswap V3 pools.
 * These values are set when the pool is created and never change.
 */

// ============================================================================
// DATA INTERFACES
// ============================================================================

/**
 * Uniswap V3 Pool Configuration Data
 *
 * Plain data interface for constructor parameters.
 * Contains all immutable parameters that define a Uniswap V3 pool.
 */
export interface UniswapV3PoolConfigData {
  /**
   * Chain ID where the pool is deployed
   * @example 1 (Ethereum), 56 (BSC), 137 (Polygon), 42161 (Arbitrum)
   */
  chainId: number;

  /**
   * Pool contract address
   * Format: 0x... (42 characters, EIP-55 checksummed)
   */
  address: string;

  /**
   * Token0 ERC-20 contract address
   * By convention, token0 < token1 (lexicographic comparison)
   */
  token0: string;

  /**
   * Token1 ERC-20 contract address
   * By convention, token1 > token0 (lexicographic comparison)
   */
  token1: string;

  /**
   * Fee tier in basis points
   * - 100 = 0.01% (1 bps)
   * - 500 = 0.05% (5 bps)
   * - 3000 = 0.3% (30 bps)
   * - 10000 = 1% (100 bps)
   */
  feeBps: number;

  /**
   * Tick spacing for this fee tier
   * Determines the granularity of price ranges
   * - 1 for 0.01% fee tier
   * - 10 for 0.05% fee tier
   * - 60 for 0.3% fee tier
   * - 200 for 1% fee tier
   */
  tickSpacing: number;
}

/**
 * JSON representation of UniswapV3PoolConfig
 * Used for API responses and database storage.
 */
export interface UniswapV3PoolConfigJSON {
  chainId: number;
  address: string;
  token0: string;
  token1: string;
  feeBps: number;
  tickSpacing: number;
}

// ============================================================================
// CONFIG CLASS
// ============================================================================

/**
 * UniswapV3PoolConfig
 *
 * Encapsulates immutable Uniswap V3 pool configuration.
 * Provides serialization methods for API and database operations.
 *
 * @example
 * ```typescript
 * const config = new UniswapV3PoolConfig({
 *   chainId: 1,
 *   address: '0x8ad599c3...',
 *   token0: '0xA0b86991...',
 *   token1: '0xC02aaA39...',
 *   feeBps: 3000,
 *   tickSpacing: 60,
 * });
 *
 * // Serialize for API
 * const json = config.toJSON();
 *
 * // Deserialize from database
 * const fromDb = UniswapV3PoolConfig.fromJSON(dbRow.config);
 * ```
 */
export class UniswapV3PoolConfig implements UniswapV3PoolConfigData {
  readonly chainId: number;
  readonly address: string;
  readonly token0: string;
  readonly token1: string;
  readonly feeBps: number;
  readonly tickSpacing: number;

  constructor(data: UniswapV3PoolConfigData) {
    this.chainId = data.chainId;
    this.address = data.address;
    this.token0 = data.token0;
    this.token1 = data.token1;
    this.feeBps = data.feeBps;
    this.tickSpacing = data.tickSpacing;
  }

  /**
   * Serialize config to JSON format.
   *
   * @returns UniswapV3PoolConfigJSON for API responses or database storage
   */
  toJSON(): UniswapV3PoolConfigJSON {
    return {
      chainId: this.chainId,
      address: this.address,
      token0: this.token0,
      token1: this.token1,
      feeBps: this.feeBps,
      tickSpacing: this.tickSpacing,
    };
  }

  /**
   * Create config from JSON data.
   *
   * @param json - JSON data from API or database
   * @returns UniswapV3PoolConfig instance
   */
  static fromJSON(json: UniswapV3PoolConfigJSON): UniswapV3PoolConfig {
    return new UniswapV3PoolConfig(json);
  }
}
