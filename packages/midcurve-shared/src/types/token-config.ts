/**
 * Platform-specific token configurations
 *
 * Token config mapping pattern ensures type-safe protocol/config pairing.
 */

import type { Token } from './token.js';

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
}

/**
 * Token Config Mapping
 *
 * Maps token type identifiers to their corresponding config types.
 * Ensures type safety: Token<'erc20'> can only have Erc20TokenConfig.
 */
export interface TokenConfigMap {
  erc20: Erc20TokenConfig;
}

/**
 * Type alias for ERC-20 token
 */
export type Erc20Token = Token<'erc20'>;

/**
 * Union type for any token
 */
export type AnyToken = Token<keyof TokenConfigMap>;
