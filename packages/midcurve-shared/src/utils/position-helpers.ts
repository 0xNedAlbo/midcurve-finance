/**
 * Position Helper Functions
 *
 * Standalone utility functions for working with positions.
 * These provide functional programming alternatives to the class methods
 * on BasePosition.
 */

import type { PositionInterface } from '../types/position/index.js';
import type { Erc20Token } from '../types/token/index.js';

/**
 * Get the quote token from a position.
 *
 * The quote token is the reference/numeraire token used to measure
 * position value. This is determined by the isToken0Quote flag.
 *
 * @param position - The position to get the quote token from
 * @returns The quote token (Erc20Token)
 *
 * @example
 * ```typescript
 * import { getQuoteToken } from '@midcurve/shared';
 *
 * const quote = getQuoteToken(position);
 * console.log(`Measuring value in ${quote.symbol}`);
 * ```
 */
export function getQuoteToken(position: PositionInterface): Erc20Token {
  return position.isToken0Quote ? position.pool.token0 : position.pool.token1;
}

/**
 * Get the base token from a position.
 *
 * The base token is the token with price risk exposure.
 * When the base token price changes, the position value (measured in
 * quote tokens) changes accordingly.
 *
 * @param position - The position to get the base token from
 * @returns The base token (Erc20Token)
 *
 * @example
 * ```typescript
 * import { getBaseToken } from '@midcurve/shared';
 *
 * const base = getBaseToken(position);
 * console.log(`Risk exposure to ${base.symbol} price`);
 * ```
 */
export function getBaseToken(position: PositionInterface): Erc20Token {
  return position.isToken0Quote ? position.pool.token1 : position.pool.token0;
}
