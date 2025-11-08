/**
 * Position Discover Input Types
 *
 * Input types for discovering position configuration from blockchain.
 * These types are protocol-specific and used by the discover() method.
 */

/**
 * Uniswap V3 Position Discover Input
 *
 * Minimal information needed to locate and read a Uniswap V3 position
 * from the blockchain.
 */
export interface UniswapV3PositionDiscoverInput {
  /**
   * Chain ID where the position exists
   * @example 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * NFT token ID
   * The token ID of the Uniswap V3 position NFT
   */
  nftId: number;
}

/**
 * Union type of all position discover inputs
 *
 * Currently only Uniswap V3 is supported.
 * Will expand as more protocols are added.
 */
export type PositionDiscoverInput = UniswapV3PositionDiscoverInput;
