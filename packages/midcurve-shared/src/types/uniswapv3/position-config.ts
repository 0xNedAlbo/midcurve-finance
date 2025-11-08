/**
 * Uniswap V3 Position Configuration
 *
 * Immutable configuration for Uniswap V3 positions.
 */

/**
 * Uniswap V3 Position Configuration
 *
 * Immutable configuration for Uniswap V3 positions.
 */
export interface UniswapV3PositionConfig {
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
