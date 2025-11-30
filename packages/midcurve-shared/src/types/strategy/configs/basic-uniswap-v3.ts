/**
 * BasicUniswapV3 Strategy Configuration
 *
 * Configuration for a basic Uniswap V3 concentrated liquidity position strategy.
 */

/**
 * Configuration for the basicUniswapV3 strategy type
 */
export interface BasicUniswapV3StrategyConfig {
  /** Chain ID where the pool exists */
  chainId: number;
  /** Uniswap V3 pool contract address */
  poolAddress: string;
  /** Lower tick boundary of the position range */
  tickLower: number;
  /** Upper tick boundary of the position range */
  tickUpper: number;
  /** Whether token0 is the quote token (true) or token1 is (false) */
  isToken0Quote: boolean;
  /** Amount of quote token to provide (as string for precision) */
  quoteTokenAmount: string;
}
