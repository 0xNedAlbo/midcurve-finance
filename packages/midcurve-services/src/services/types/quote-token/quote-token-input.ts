/**
 * Quote Token Input Types
 *
 * Service-layer input types for quote token determination.
 * NOT shared with UI/API (they receive QuoteTokenResult).
 */

import type { PoolConfigMap } from '@midcurve/shared';

/**
 * Quote token determination input map
 * Maps protocol identifier to its input type
 */
export interface QuoteTokenInputMap {
  uniswapv3: UniswapV3QuoteTokenInput;

  /**
   * HODL quote token determination (placeholder)
   *
   * HODL positions use user-provided quote token directly.
   * They don't need quote token determination logic.
   * This placeholder ensures type compatibility with PoolConfigMap.
   */
  hodl: never; // HODL uses direct quote token selection

  // Future protocols:
  // orca: OrcaQuoteTokenInput;
  // raydium: RaydiumQuoteTokenInput;
}

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
 * Example: Orca (Solana) quote token determination input
 * Uncomment when implementing Orca support
 */
// export interface OrcaQuoteTokenInput {
//   userId: string;
//   token0Mint: string;     // Solana mint address (base58)
//   token1Mint: string;     // Solana mint address (base58)
// }

/**
 * Generic quote token determination input
 * Constrains to valid protocol keys from PoolConfigMap
 */
export type QuoteTokenInput<P extends keyof PoolConfigMap> =
  QuoteTokenInputMap[P];
