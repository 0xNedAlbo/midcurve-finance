/**
 * Service layer input types for token CRUD operations
 * These types are used for database operations and are not shared with UI/API
 *
 * Note: Uses data interfaces (Erc20TokenConfigData) not classes for inputs.
 * Services create class instances internally for serialization.
 */

import type {
  TokenType,
  Erc20TokenConfigData,
  BasicCurrencyConfigData,
} from '@midcurve/shared';

// =============================================================================
// BASE INPUT INTERFACES
// =============================================================================

/**
 * Base input interface for creating any token
 * Subtype inputs extend this with their specific config type
 */
interface BaseCreateTokenInput {
  /** Token type discriminator */
  tokenType: TokenType;
  /** Human-readable token name */
  name: string;
  /** Token symbol (e.g., "USDC") */
  symbol: string;
  /** Number of decimal places */
  decimals: number;
  /** Optional URL to token logo */
  logoUrl?: string;
  /** Optional CoinGecko identifier */
  coingeckoId?: string;
  /** Optional market cap in USD */
  marketCap?: number;
}

/**
 * Base input interface for updating any token
 * All fields are optional except those that identify the token
 */
interface BaseUpdateTokenInput {
  /** Human-readable token name */
  name?: string;
  /** Token symbol */
  symbol?: string;
  /** Number of decimal places */
  decimals?: number;
  /** URL to token logo */
  logoUrl?: string;
  /** CoinGecko identifier */
  coingeckoId?: string;
  /** Market cap in USD */
  marketCap?: number;
}

// =============================================================================
// ERC-20 TOKEN INPUT TYPES
// =============================================================================

/**
 * Input for creating a new ERC-20 token
 */
export interface CreateErc20TokenInput extends BaseCreateTokenInput {
  tokenType: 'erc20';
  config: Erc20TokenConfigData;
}

/**
 * Input for updating an existing ERC-20 token
 */
export interface UpdateErc20TokenInput extends BaseUpdateTokenInput {
  config?: Partial<Erc20TokenConfigData>;
}

/**
 * Input for discovering an ERC-20 token from on-chain data
 */
export interface Erc20TokenDiscoverInput {
  /** Token contract address (any case, will be normalized) */
  address: string;
  /** Chain ID where token exists */
  chainId: number;
}

/**
 * Input for searching ERC-20 tokens in CoinGecko
 */
export interface Erc20TokenSearchInput {
  /** EVM chain ID where tokens should exist */
  chainId: number;
  /** Optional partial symbol match (case-insensitive) */
  symbol?: string;
  /** Optional partial name match (case-insensitive) */
  name?: string;
  /** Optional contract address to search for (case-insensitive, will be normalized) */
  address?: string;
}

/**
 * Search result candidate for ERC-20 tokens from CoinGecko
 * Not a full Token object - missing id, decimals, timestamps (not in database yet)
 */
export interface Erc20TokenSearchCandidate {
  /** CoinGecko coin ID */
  coingeckoId: string;
  /** Token symbol (uppercase) */
  symbol: string;
  /** Token name */
  name: string;
  /** Contract address on the specified chain */
  address: string;
  /** EVM chain ID where this token exists */
  chainId: number;
  /** Token logo URL from CoinGecko (if available) */
  logoUrl?: string;
  /** Market cap in USD (used for sorting results by popularity) */
  marketCap?: number;
}

// =============================================================================
// BASIC CURRENCY TOKEN INPUT TYPES
// =============================================================================

/**
 * Input for creating a new basic currency token
 */
export interface CreateBasicCurrencyTokenInput extends BaseCreateTokenInput {
  tokenType: 'basic-currency';
  config: BasicCurrencyConfigData;
}

/**
 * Input for updating an existing basic currency token
 */
export interface UpdateBasicCurrencyTokenInput extends BaseUpdateTokenInput {
  config?: Partial<BasicCurrencyConfigData>;
}

/**
 * Input for discovering a basic currency token
 * Basic currencies are pre-defined and not discovered on-chain.
 * This is a placeholder for the abstract discover() method.
 */
export interface BasicCurrencyDiscoverInput {
  /** Currency code (e.g., 'USD', 'ETH', 'BTC') */
  currencyCode: string;
}

/**
 * Input for searching basic currency tokens
 * Basic currencies are pre-defined, so search just filters the known currencies.
 */
export interface BasicCurrencySearchInput {
  /** Optional currency code filter (e.g., 'USD', 'ETH', 'BTC') */
  currencyCode?: string;
}

/**
 * Search result candidate for basic currencies
 * Returns the pre-defined basic currency info.
 */
export interface BasicCurrencySearchCandidate {
  /** Currency code (e.g., 'USD', 'ETH', 'BTC') */
  currencyCode: string;
  /** Currency name (e.g., 'US Dollar', 'Ethereum', 'Bitcoin') */
  name: string;
  /** Currency symbol (same as currencyCode for basic currencies) */
  symbol: string;
}

// =============================================================================
// UNION TYPES
// =============================================================================

/**
 * Union type for any token create input
 */
export type CreateAnyTokenInput = CreateErc20TokenInput | CreateBasicCurrencyTokenInput;

/**
 * Union type for any token update input
 */
export type UpdateAnyTokenInput = UpdateErc20TokenInput | UpdateBasicCurrencyTokenInput;

/**
 * Union type for any token discovery input
 */
export type AnyTokenDiscoverInput = Erc20TokenDiscoverInput | BasicCurrencyDiscoverInput;

/**
 * Union type for any token search input
 */
export type AnyTokenSearchInput = Erc20TokenSearchInput | BasicCurrencySearchInput;

/**
 * Union type for any token search candidate
 */
export type AnyTokenSearchCandidate = Erc20TokenSearchCandidate | BasicCurrencySearchCandidate;
