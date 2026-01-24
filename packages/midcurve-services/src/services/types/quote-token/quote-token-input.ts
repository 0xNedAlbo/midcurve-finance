/**
 * Quote Token Input Types
 *
 * Service-layer input types for quote token determination.
 * NOT shared with UI/API (they receive QuoteTokenResult).
 */

/**
 * Uniswap V3 quote token determination input
 */
export interface UniswapV3QuoteTokenInput {
  /**
   * User ID for preference lookup
   */
  userId: string;

  /**
   * Chain ID (1 = Ethereum, 42161 = Arbitrum, etc.)
   */
  chainId: number;

  /**
   * Token0 address (EVM address, any case, will be normalized)
   */
  token0Address: string;

  /**
   * Token1 address (EVM address, any case, will be normalized)
   */
  token1Address: string;
}

/**
 * Map of protocol to input type
 */
export interface QuoteTokenInputMap {
  uniswapv3: UniswapV3QuoteTokenInput;
}

/**
 * Union of all quote token inputs
 */
export type QuoteTokenInput = UniswapV3QuoteTokenInput;
