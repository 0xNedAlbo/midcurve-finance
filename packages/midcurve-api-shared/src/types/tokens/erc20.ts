/**
 * ERC-20 Token Endpoint Types and Schemas
 *
 * Types and Zod schemas for ERC-20 token management endpoints.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

/**
 * POST /api/v1/tokens/erc20 - Request body
 */
export interface CreateErc20TokenRequest {
  /**
   * Token contract address (any format, normalized by service)
   */
  address: string;

  /**
   * EVM chain ID
   */
  chainId: number;
}

/**
 * POST /api/v1/tokens/erc20 - Request validation
 */
export const CreateErc20TokenRequestSchema = z.object({
  address: z
    .string()
    .min(1, 'Address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format'),
  chainId: z
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),
});

/**
 * Token data structure (for create/discover response - full Token object)
 */
export interface CreateErc20TokenData {
  id: string;
  tokenType: 'erc20';
  name: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  coingeckoId?: string;
  marketCap?: number;
  config: {
    address: string;
    chainId: number;
  };
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * POST /api/v1/tokens/erc20 - Response
 */
export type CreateErc20TokenResponse = ApiResponse<CreateErc20TokenData>;

/**
 * Token search candidate from CoinGecko (lightweight, not in database yet)
 *
 * @deprecated Use TokenSymbolResult instead - this type will be removed
 */
export interface TokenSearchCandidate {
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

/**
 * Token address on a specific chain
 */
export interface TokenAddress {
  /** EVM chain ID */
  chainId: number;
  /** Contract address (EIP-55 checksummed) */
  address: string;
}

/**
 * Token search result grouped by symbol
 *
 * Returns a token symbol with all its addresses across the requested chains.
 * Results are sorted by market cap (MAX across chains) in descending order.
 */
export interface TokenSymbolResult {
  /** Token symbol (uppercase, e.g., "WETH") */
  symbol: string;
  /** Token name (e.g., "Wrapped Ether") */
  name: string;
  /** CoinGecko coin ID */
  coingeckoId: string;
  /** Token logo URL from CoinGecko (if available) */
  logoUrl?: string;
  /** Market cap in USD (MAX across all chains, used for sorting) */
  marketCap?: number;
  /** All addresses for this token across the requested chains */
  addresses: TokenAddress[];
}

/**
 * GET /api/v1/tokens/erc20/search - Query params
 */
export interface SearchErc20TokensQuery {
  /**
   * REQUIRED - Chain IDs to search within (comma-separated in URL)
   * Example: ?chainIds=1,42161,8453
   */
  chainIds: number[];

  /**
   * REQUIRED - search query (searches symbol, case-insensitive partial match)
   */
  query: string;
}

/**
 * GET /api/v1/tokens/erc20/search - Query validation
 *
 * chainIds is REQUIRED (comma-separated string, e.g., "1,42161,8453")
 * query is REQUIRED (minimum 1 character)
 */
export const SearchErc20TokensQuerySchema = z.object({
  chainIds: z
    .string()
    .min(1, 'Chain IDs are required')
    .transform((val) =>
      val
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => parseInt(s, 10))
    )
    .refine(
      (arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n > 0),
      { message: 'Chain IDs must be positive integers' }
    ),
  query: z.string().min(1, 'Query must not be empty'),
});

/**
 * GET /api/v1/tokens/erc20/search - Response data (array of token symbols with addresses)
 */
export type SearchErc20TokensData = TokenSymbolResult[];

/**
 * GET /api/v1/tokens/erc20/search - Response
 */
export interface SearchErc20TokensResponse extends ApiResponse<SearchErc20TokensData> {
  meta?: {
    count: number; // Number of unique symbols returned
    limit: number; // Max symbols (always 10)
    timestamp: string;
  };
}

// ============================================================================
// Address-based Token Search
// ============================================================================

/**
 * GET /api/v1/tokens/erc20/search-by-address - Query params
 *
 * Search for a token by its contract address across multiple chains.
 */
export interface SearchTokenByAddressQuery {
  /**
   * REQUIRED - Token contract address (0x + 40 hex chars)
   */
  address: string;

  /**
   * OPTIONAL - Chain IDs to search within (comma-separated in URL)
   * If not provided, searches all supported chains.
   * Example: ?chainIds=1,42161,8453
   */
  chainIds?: number[];
}

/**
 * GET /api/v1/tokens/erc20/search-by-address - Query validation
 *
 * address is REQUIRED (valid Ethereum address format)
 * chainIds is OPTIONAL (comma-separated string, e.g., "1,42161,8453")
 */
export const SearchTokenByAddressQuerySchema = z.object({
  address: z
    .string()
    .min(1, 'Address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format'),
  chainIds: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .map((s) => parseInt(s, 10))
        : undefined
    )
    .refine((arr) => !arr || arr.every((n) => Number.isInteger(n) && n > 0), {
      message: 'Chain IDs must be positive integers',
    }),
});

/**
 * GET /api/v1/tokens/erc20/search-by-address - Response data
 *
 * Returns array of TokenSymbolResult for consistency with symbol search.
 * Each result represents a unique symbol found, with addresses on each chain.
 */
export type SearchTokenByAddressData = TokenSymbolResult[];

/**
 * GET /api/v1/tokens/erc20/search-by-address - Response
 */
export interface SearchTokenByAddressResponse
  extends ApiResponse<SearchTokenByAddressData> {
  meta?: {
    address: string; // Normalized address searched
    chainsSearched: number; // Number of chains checked
    chainsWithResults: number; // Number of chains where token was found
    timestamp: string;
  };
}
