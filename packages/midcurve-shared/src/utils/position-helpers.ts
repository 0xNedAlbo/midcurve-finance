/**
 * Position Helper Functions
 *
 * Standalone utility functions for working with UniswapV3 positions.
 * These provide functional programming alternatives to the class methods
 * on UniswapV3Position.
 */

import type { UniswapV3Position } from '../types/position/uniswapv3/uniswapv3-position.js';
import type { TokenInterface } from '../types/token/index.js';

/**
 * Get the quote token from a UniswapV3 position.
 *
 * The quote token is the reference/numeraire token used to measure
 * position value. This is determined by the isToken0Quote config.
 *
 * @param position - The position to get the quote token from
 * @returns The quote token
 */
export function getQuoteToken(position: UniswapV3Position): TokenInterface {
  return position.isToken0Quote ? position.pool.token0 : position.pool.token1;
}

/**
 * Get the base token from a UniswapV3 position.
 *
 * The base token is the token with price risk exposure.
 * When the base token price changes, the position value (measured in
 * quote tokens) changes accordingly.
 *
 * @param position - The position to get the base token from
 * @returns The base token
 */
export function getBaseToken(position: UniswapV3Position): TokenInterface {
  return position.isToken0Quote ? position.pool.token1 : position.pool.token0;
}
