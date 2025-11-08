/**
 * Token - Abstract interface for tokens across multiple blockchain platforms
 *
 * Uses mapped types to enforce correct tokenType/config pairing.
 */

import type { TokenConfigMap } from './token-config.js';

// Re-export TokenConfigMap for service layer
export type { TokenConfigMap } from './token-config.js';

/**
 * Token type identifier
 * Derived from TokenConfigMap keys for type safety
 */
export type TokenType = keyof TokenConfigMap;

/**
 * Token interface with mapped type parameter
 *
 * Type safety: Token<'erc20'> can only have tokenType: 'erc20' and Erc20TokenConfig.
 *
 * @template T - Token type key from TokenConfigMap ('erc20', etc.)
 */
export interface Token<T extends keyof TokenConfigMap> {
  /**
   * Unique identifier (cuid)
   */
  id: string;

  /**
   * Timestamp when token was created
   */
  createdAt: Date;

  /**
   * Timestamp when token was last updated
   */
  updatedAt: Date;

  /**
   * Token type identifier
   * Must match the generic parameter T
   */
  tokenType: T;

  /**
   * Token name (e.g., "Wrapped Ether", "USD Coin")
   */
  name: string;

  /**
   * Token symbol (e.g., "WETH", "USDC")
   */
  symbol: string;

  /**
   * Number of decimal places
   * E.g., 18 for WETH, 6 for USDC
   */
  decimals: number;

  /**
   * URL to the token's logo/icon (optional)
   */
  logoUrl?: string;

  /**
   * CoinGecko ID for price/market data (optional)
   */
  coingeckoId?: string;

  /**
   * Market capitalization in USD (optional)
   */
  marketCap?: number;

  /**
   * Platform-specific configuration
   * Type determined by tokenType parameter T
   */
  config: TokenConfigMap[T];
}

// Re-export type aliases
export type { Erc20Token, AnyToken } from './token-config.js';
