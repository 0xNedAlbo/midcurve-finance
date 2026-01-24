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
  readonly tickUpper: number;
  readonly tickLower: number;

  constructor(data: UniswapV3PositionConfigData) {
    this.chainId = data.chainId;
    this.nftId = data.nftId;
    this.poolAddress = data.poolAddress;
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
    };
  }

  /**
   * Create from JSON (database or API input).
   */
  static fromJSON(json: UniswapV3PositionConfigJSON): UniswapV3PositionConfig {
    return new UniswapV3PositionConfig({
      chainId: json.chainId,
      nftId: json.nftId,
      poolAddress: json.poolAddress,
      tickUpper: json.tickUpper,
      tickLower: json.tickLower,
    });
  }
}
