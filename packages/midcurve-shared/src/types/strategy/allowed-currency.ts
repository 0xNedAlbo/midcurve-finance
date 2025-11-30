/**
 * Allowed Currency Types for Strategy Intents
 *
 * Defines which tokens/currencies a strategy is permitted to interact with.
 * Uses discriminated union pattern for type safety.
 */

/**
 * Discriminator for allowed currency types
 */
export type AllowedCurrencyType = 'erc20' | 'evmNative';

/**
 * ERC-20 Token Reference
 * References an ERC-20 token by chain and address.
 */
export interface Erc20AllowedCurrency {
  currencyType: 'erc20';
  /** Chain ID where the token exists */
  chainId: number;
  /** EIP-55 checksummed contract address */
  address: string;
  /** Token symbol (e.g., 'USDC', 'WETH') */
  symbol: string;
}

/**
 * EVM Native Currency (ETH, BNB, MATIC, etc.)
 */
export interface EvmNativeAllowedCurrency {
  currencyType: 'evmNative';
  /** Chain ID (e.g., 1 for ETH, 56 for BNB) */
  chainId: number;
  /** Currency symbol (e.g., 'ETH', 'BNB', 'MATIC') */
  symbol: string;
}

/**
 * Union of all allowed currency types
 */
export type AllowedCurrency = Erc20AllowedCurrency | EvmNativeAllowedCurrency;

// ============================================================
// Type Guards
// ============================================================

/**
 * Type guard for ERC-20 currency
 */
export function isErc20Currency(
  currency: AllowedCurrency
): currency is Erc20AllowedCurrency {
  return currency.currencyType === 'erc20';
}

/**
 * Type guard for EVM native currency
 */
export function isEvmNativeCurrency(
  currency: AllowedCurrency
): currency is EvmNativeAllowedCurrency {
  return currency.currencyType === 'evmNative';
}
