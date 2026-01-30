/**
 * CoingeckoTokenConfig - Configuration for CoinGecko token lookup entries
 *
 * Follows the three-layer config pattern:
 * 1. Data interface (plain object shape)
 * 2. JSON interface (serialization shape)
 * 3. Config class (immutable value object)
 */

/**
 * Data interface for CoinGecko token configuration.
 * Used for constructor parameters and type inference.
 */
export interface CoingeckoTokenConfigData {
  /** Chain ID where the token exists (1, 42161, 8453, 56, 137, 10) */
  chainId: number;
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
}

/**
 * JSON interface for serialization.
 * Matches the database JSON column format.
 */
export interface CoingeckoTokenConfigJSON {
  chainId: number;
  tokenAddress: string;
}

/**
 * CoinGecko token configuration class.
 * Immutable value object with serialization support.
 */
export class CoingeckoTokenConfig implements CoingeckoTokenConfigData {
  readonly chainId: number;
  readonly tokenAddress: string;

  constructor(data: CoingeckoTokenConfigData) {
    this.chainId = data.chainId;
    this.tokenAddress = data.tokenAddress;
  }

  /**
   * Serialize to JSON format for database storage
   */
  toJSON(): CoingeckoTokenConfigJSON {
    return {
      chainId: this.chainId,
      tokenAddress: this.tokenAddress,
    };
  }

  /**
   * Deserialize from JSON format (database or API)
   */
  static fromJSON(json: CoingeckoTokenConfigJSON): CoingeckoTokenConfig {
    return new CoingeckoTokenConfig({
      chainId: json.chainId,
      tokenAddress: json.tokenAddress,
    });
  }
}
