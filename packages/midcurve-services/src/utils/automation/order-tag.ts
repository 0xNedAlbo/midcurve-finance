/**
 * Order Tag Generation Utilities
 *
 * Generates human-readable order identifiers for automation log messages.
 * Format: "{DIRECTION}@{PRICE}" e.g., "TP@3300.34" or "SL@1450.12"
 */

import {
  formatCompactValue,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
  tickToSqrtRatioX96,
} from '@midcurve/shared';

/**
 * Parameters for generating an order tag
 */
export interface OrderTagParams {
  /**
   * Trigger side: 'lower' (SL) or 'upper' (TP)
   */
  triggerSide: 'lower' | 'upper';

  /**
   * Trigger price in sqrtPriceX96 format
   */
  sqrtPriceX96: bigint;

  /**
   * Whether token0 is the quote token
   */
  token0IsQuote: boolean;

  /**
   * Token0 decimals
   */
  token0Decimals: number;

  /**
   * Token1 decimals
   */
  token1Decimals: number;
}

/**
 * Generates a human-readable order tag for log messages
 *
 * Converts sqrtPriceX96 to quote token price and formats as:
 * "{DIRECTION}@{PRICE}" e.g., "TP@3300.34" or "SL@1450.12"
 *
 * @param params - Order tag generation parameters
 * @returns Order tag like "TP@3300.34" or "SL@1450.12"
 *
 * @example
 * // ETH/USDC pool where USDC (token1) is quote
 * generateOrderTag({
 *   triggerSide: 'upper',
 *   sqrtPriceX96: 4567890123456789012345678901234n,
 *   token0IsQuote: false,  // USDC is token1
 *   token0Decimals: 18,    // ETH
 *   token1Decimals: 6,     // USDC
 * });
 * // Returns: "TP@3300.34"
 *
 * @example
 * // USDC/ETH pool where USDC (token0) is quote
 * generateOrderTag({
 *   triggerSide: 'lower',
 *   sqrtPriceX96: 1234567890123456789012345678901n,
 *   token0IsQuote: true,   // USDC is token0
 *   token0Decimals: 6,     // USDC
 *   token1Decimals: 18,    // ETH
 * });
 * // Returns: "SL@1450.12"
 */
/**
 * Parameters for generating an order tag from a tick (no sqrtPriceX96 needed)
 */
export interface OrderTagFromTickParams {
  triggerSide: 'lower' | 'upper';
  triggerTick: number;
  token0IsQuote: boolean;
  token0Decimals: number;
  token1Decimals: number;
}

/**
 * Generates an order tag from a trigger tick.
 * Convenience wrapper that converts tick → sqrtPriceX96 internally.
 */
export function generateOrderTagFromTick(params: OrderTagFromTickParams): string {
  const sqrtPriceX96 = BigInt(tickToSqrtRatioX96(params.triggerTick).toString());
  return generateOrderTag({
    triggerSide: params.triggerSide,
    sqrtPriceX96,
    token0IsQuote: params.token0IsQuote,
    token0Decimals: params.token0Decimals,
    token1Decimals: params.token1Decimals,
  });
}

export function generateOrderTag(params: OrderTagParams): string {
  const {
    triggerSide,
    sqrtPriceX96,
    token0IsQuote,
    token0Decimals,
    token1Decimals,
  } = params;

  // Determine direction label
  // Upper trigger = Take Profit (price going up past threshold)
  // Lower trigger = Stop Loss (price going down past threshold)
  const direction = triggerSide === 'upper' ? 'TP' : 'SL';

  // Convert sqrtPriceX96 to price in quote token terms
  let priceInQuote: bigint;
  let quoteDecimals: number;

  if (token0IsQuote) {
    // Quote is token0, base is token1
    // Price = how many token0 (quote) per 1 token1 (base)
    priceInQuote = pricePerToken1InToken0(sqrtPriceX96, token1Decimals);
    quoteDecimals = token0Decimals;
  } else {
    // Quote is token1, base is token0
    // Price = how many token1 (quote) per 1 token0 (base)
    priceInQuote = pricePerToken0InToken1(sqrtPriceX96, token0Decimals);
    quoteDecimals = token1Decimals;
  }

  // Format price compactly (e.g., "3300.34", "0.00123")
  const formattedPrice = formatCompactValue(priceInQuote, quoteDecimals);

  return `${direction}@${formattedPrice}`;
}
