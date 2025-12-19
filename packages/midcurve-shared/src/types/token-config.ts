/**
 * Platform-specific token configurations
 *
 * Token config mapping pattern ensures type-safe protocol/config pairing.
 */

import type { Token } from './token.js';

// =============================================================================
// ERC-20 TOKEN CONFIG
// =============================================================================

/**
 * ERC-20 token configuration (EVM-compatible chains)
 * Used for: Ethereum, BSC, Arbitrum, Base, Polygon, Optimism, etc.
 */
export interface Erc20TokenConfig {
  /**
   * Token contract address (ERC-20)
   * Format: 0x... (42 characters, EIP-55 checksummed)
   */
  address: string;

  /**
   * Chain ID (identifies the specific EVM chain)
   * Examples: 1 (Ethereum), 56 (BSC), 137 (Polygon), 42161 (Arbitrum)
   */
  chainId: number;

  /**
   * Optional link to a basic currency for cross-platform aggregation.
   * If set, this token's value is treated as equivalent to the basic currency (1:1).
   *
   * Examples:
   * - USDC, USDT, DAI → USD basic currency
   * - WETH → ETH basic currency
   * - WBTC, cbBTC → BTC basic currency
   *
   * Note: Value-accruing tokens (stETH, rETH, wstETH) should NOT be linked
   * since they don't have a 1:1 relationship with their underlying asset.
   */
  basicCurrencyId?: string;
}

// =============================================================================
// BASIC CURRENCY CONFIG
// =============================================================================

/**
 * Basic Currency configuration (platform-agnostic)
 *
 * Basic currencies are canonical units for cross-platform metrics aggregation.
 * They represent abstract value units (USD, ETH, BTC) that platform-specific
 * tokens can link to for normalization.
 *
 * All basic currencies use 18 decimals for consistent precision.
 */
export interface BasicCurrencyConfig {
  /**
   * Currency code identifier (uppercase)
   * Examples: 'USD', 'ETH', 'BTC'
   */
  currencyCode: string;

  /**
   * CoinGecko vs_currency identifier (lowercase)
   *
   * Used for price queries: GET /simple/price?vs_currencies={coingeckoCurrency}
   * Examples: 'usd', 'eth', 'btc'
   *
   * Obtained from: GET /simple/supported_vs_currencies
   * This field enables price conversion for valuation in the quote currency.
   */
  coingeckoCurrency: string;
}

// =============================================================================
// TOKEN CONFIG MAP
// =============================================================================

/**
 * Token Config Mapping
 *
 * Maps token type identifiers to their corresponding config types.
 * Ensures type safety: Token<'erc20'> can only have Erc20TokenConfig.
 */
export interface TokenConfigMap {
  erc20: Erc20TokenConfig;
  'basic-currency': BasicCurrencyConfig;
}

// =============================================================================
// TYPE ALIASES
// =============================================================================

/**
 * Type alias for ERC-20 token
 */
export type Erc20Token = Token<'erc20'>;

/**
 * Type alias for basic currency token
 */
export type BasicCurrencyToken = Token<'basic-currency'>;

/**
 * Union type for any token
 */
export type AnyToken = Token<keyof TokenConfigMap>;
