/**
 * Uniswap V3 Position Configuration
 *
 * Immutable configuration for Uniswap V3 positions.
 * Contains chain, NFT ID, pool address, and tick bounds.
 */

// ============================================================================
// DATA INTERFACE
// ============================================================================

/**
 * Data interface for UniswapV3PositionConfig.
 */
export interface UniswapV3PositionConfigData {
  /**
   * Chain ID where the position exists
   * @example 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * NFT token ID
   * Unique identifier for the Uniswap V3 position NFT
   */
  nftId: number;

  /**
   * Pool address on the blockchain
   * EIP-55 checksummed address
   */
  poolAddress: string;

  /**
   * Token0 ERC-20 contract address (EIP-55 checksummed)
   * By convention, token0 < token1 (lexicographic comparison)
   */
  token0Address: string;

  /**
   * Token1 ERC-20 contract address (EIP-55 checksummed)
   * By convention, token1 > token0 (lexicographic comparison)
   */
  token1Address: string;

  /**
   * Fee tier in basis points
   * - 100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%
   */
  feeBps: number;

  /**
   * Tick spacing for this fee tier
   * - 1 for 0.01%, 10 for 0.05%, 60 for 0.3%, 200 for 1%
   */
  tickSpacing: number;

  /**
   * Upper tick bound
   * The upper tick of the position's price range
   */
  tickUpper: number;

  /**
   * Lower tick bound
   * The lower tick of the position's price range
   */
  tickLower: number;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

/**
 * JSON representation for API responses.
 * All fields are JSON-safe (no bigint).
 */
export interface UniswapV3PositionConfigJSON {
  chainId: number;
  nftId: number;
  poolAddress: string;
  tickUpper: number;
  tickLower: number;
  // Pool-level fields (optional — present in DB JSON, omitted from API responses)
  token0Address?: string;
  token1Address?: string;
  feeBps?: number;
  tickSpacing?: number;
}

// ============================================================================
// CONFIG CLASS
// ============================================================================

/**
 * UniswapV3PositionConfig
 *
 * Immutable configuration class for Uniswap V3 positions.
 * Provides serialization methods for database and API operations.
 *
 * @example
 * ```typescript
 * const config = new UniswapV3PositionConfig({
 *   chainId: 1,
 *   nftId: 123456,
 *   poolAddress: '0x1234...',
 *   tickUpper: 202920,
 *   tickLower: 202820,
 * });
 *
 * // Serialize for API
 * const json = config.toJSON();
 *
 * // Deserialize from database
 * const restored = UniswapV3PositionConfig.fromJSON(json);
 * ```
 */
export class UniswapV3PositionConfig implements UniswapV3PositionConfigData {
  readonly chainId: number;
  readonly nftId: number;
  readonly poolAddress: string;
  readonly token0Address: string;
  readonly token1Address: string;
  readonly feeBps: number;
  readonly tickSpacing: number;
  readonly tickUpper: number;
  readonly tickLower: number;

  constructor(data: UniswapV3PositionConfigData) {
    this.chainId = data.chainId;
    this.nftId = data.nftId;
    this.poolAddress = data.poolAddress;
    this.token0Address = data.token0Address;
    this.token1Address = data.token1Address;
    this.feeBps = data.feeBps;
    this.tickSpacing = data.tickSpacing;
    this.tickUpper = data.tickUpper;
    this.tickLower = data.tickLower;
  }

  /**
   * Serialize to JSON for API responses.
   */
  toJSON(): UniswapV3PositionConfigJSON {
    return {
      chainId: this.chainId,
      nftId: this.nftId,
      poolAddress: this.poolAddress,
      tickUpper: this.tickUpper,
      tickLower: this.tickLower,
      // Pool-level fields intentionally omitted — they appear in pool.config via the computed getter
    };
  }

  /**
   * Create from JSON (database or API input).
   */
  static fromJSON(json: UniswapV3PositionConfigJSON): UniswapV3PositionConfig {
    return new UniswapV3PositionConfig({
      ...json,
      token0Address: json.token0Address ?? '',
      token1Address: json.token1Address ?? '',
      feeBps: json.feeBps ?? 0,
      tickSpacing: json.tickSpacing ?? 0,
    });
  }
}
