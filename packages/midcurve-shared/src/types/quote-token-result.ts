/**
 * Quote Token Result Types
 *
 * Shared types for quote token determination results.
 * Used across API, UI, Workers, and Services.
 */

import type { PoolConfigMap } from './pool-config.js';

/**
 * Quote token determination result
 *
 * Generic type P constrains to protocol keys from PoolConfigMap ('uniswapv3', etc.)
 *
 * @template P - Protocol identifier (e.g., 'uniswapv3', 'orca', 'raydium')
 */
export interface QuoteTokenResult<P extends keyof PoolConfigMap> {
  /**
   * Whether token0 is the quote token
   * - true: token0 = quote, token1 = base
   * - false: token1 = quote, token0 = base
   */
  isToken0Quote: boolean;

  /**
   * Quote token identifier (protocol-specific)
   * - EVM: normalized address (0x...)
   * - Solana: mint address (base58)
   */
  quoteTokenId: string;

  /**
   * Base token identifier (protocol-specific)
   */
  baseTokenId: string;

  /**
   * Optional: Token symbols for display
   */
  quoteTokenSymbol?: string;
  baseTokenSymbol?: string;

  /**
   * How the quote token was determined
   */
  matchedBy: 'user_preference' | 'default' | 'fallback';

  /**
   * Protocol identifier
   */
  protocol: P;
}

/**
 * Uniswap V3 specific quote token result
 */
export type UniswapV3QuoteTokenResult = QuoteTokenResult<'uniswapv3'>;

// Future protocol results:
// export type OrcaQuoteTokenResult = QuoteTokenResult<'orca'>;
// export type RaydiumQuoteTokenResult = QuoteTokenResult<'raydium'>;
