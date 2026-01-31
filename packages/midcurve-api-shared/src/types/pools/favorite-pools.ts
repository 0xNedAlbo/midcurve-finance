/**
 * Favorite Pools Endpoint Types
 *
 * Types for the favorite pool management endpoints:
 * - POST /api/v1/pools/favorites - Add pool to favorites
 * - GET /api/v1/pools/favorites - List favorite pools (with optional protocol filter)
 * - DELETE /api/v1/pools/favorites?protocol=...&chainId=...&address=... - Remove from favorites
 */

import { z } from 'zod';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { ApiResponse } from '../common/index.js';
import type { BigIntToString } from '../common/serialization.js';

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * POST /api/v1/pools/uniswapv3/favorites - Request body
 *
 * Add a pool to user's favorites by chainId and poolAddress.
 */
export interface AddFavoritePoolRequest {
  /**
   * Chain ID where the pool is deployed
   *
   * Supported chains:
   * - 1: Ethereum
   * - 42161: Arbitrum
   * - 8453: Base
   * - 10: Optimism
   * - 137: Polygon
   * - 56: BSC
   *
   * @example 1
   */
  chainId: number;

  /**
   * Pool contract address (EIP-55 checksummed or lowercase)
   *
   * @example "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  poolAddress: string;
}

/**
 * DELETE /api/v1/pools/uniswapv3/favorites/:chainId/:address - Path parameters
 *
 * Remove a pool from user's favorites by chainId and address.
 */
export interface RemoveFavoritePoolParams {
  /**
   * Chain ID where the pool is deployed
   * @example "1"
   */
  chainId: string;

  /**
   * Pool contract address
   * @example "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  address: string;
}

/**
 * GET /api/v1/pools/uniswapv3/favorites - Query parameters
 *
 * List user's favorite pools with optional pagination.
 */
export interface ListFavoritePoolsQuery {
  /**
   * Maximum number of results to return
   *
   * @default 50
   * @max 100
   */
  limit?: number;

  /**
   * Offset for pagination
   *
   * @default 0
   */
  offset?: number;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Serialized UniswapV3Pool for API responses
 *
 * All bigint and Date fields are converted to strings for JSON compatibility.
 */
export type SerializedUniswapV3Pool = BigIntToString<UniswapV3Pool>;

/**
 * Single favorite pool item
 *
 * Contains pool identification (poolHash, chainId, poolAddress), full pool data,
 * and current metrics from The Graph subgraph.
 * Note: Does NOT include database IDs.
 */
export interface FavoritePoolItem {
  /**
   * Pool hash - unique composite key
   *
   * Format: "{protocol}/{chainId}/{normalizedPoolAddress}"
   * @example "uniswapv3/1/0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  poolHash: string;

  /**
   * Chain ID where the pool is deployed
   * @example 1
   */
  chainId: number;

  /**
   * Pool contract address (EIP-55 checksummed)
   * @example "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  poolAddress: string;

  /**
   * When the pool was added to favorites (ISO 8601)
   * @example "2025-01-31T10:30:00.000Z"
   */
  favoritedAt: string;

  /**
   * Full pool data with current state
   *
   * Includes tokens, config, and latest on-chain state.
   * BigInt fields (sqrtPriceX96, liquidity, etc.) are serialized as strings.
   */
  pool: SerializedUniswapV3Pool;

  // =========================================================================
  // Pool metrics from subgraph
  // =========================================================================

  /**
   * Total Value Locked in USD
   * @example "1234567.89"
   */
  tvlUSD: string;

  /**
   * 24-hour trading volume in USD
   * @example "456789.12"
   */
  volume24hUSD: string;

  /**
   * 24-hour fees collected in USD
   * @example "1234.56"
   */
  fees24hUSD: string;

  /**
   * 7-day fees collected in USD
   * @example "8642.15"
   */
  fees7dUSD: string;

  /**
   * 7-day average APR percentage
   *
   * Calculated as: (fees7d / 7 * 365) / tvl * 100
   * @example 12.34
   */
  apr7d: number;
}

/**
 * POST /api/v1/pools/uniswapv3/favorites - Response data
 *
 * Returns the newly added (or existing) favorite pool.
 */
export interface AddFavoritePoolData {
  /**
   * The favorited pool
   */
  favorite: FavoritePoolItem;

  /**
   * Whether this pool was already favorited
   *
   * true if the pool was already in favorites (returns existing)
   * false if newly added
   */
  alreadyFavorited: boolean;
}

/**
 * POST /api/v1/pools/uniswapv3/favorites - Full response
 */
export interface AddFavoritePoolResponse extends ApiResponse<AddFavoritePoolData> {
  meta?: {
    /** Timestamp of the operation */
    timestamp?: string;
  };
}

/**
 * GET /api/v1/pools/uniswapv3/favorites - Response data
 *
 * List of favorite pools with pagination info.
 */
export interface ListFavoritePoolsData {
  /**
   * Array of favorite pools
   *
   * Ordered by favoritedAt descending (most recent first).
   */
  favorites: FavoritePoolItem[];

  /**
   * Total number of favorites for the user
   *
   * Use for pagination (total vs returned count).
   */
  total: number;
}

/**
 * GET /api/v1/pools/uniswapv3/favorites - Full response
 */
export interface ListFavoritePoolsResponse extends ApiResponse<ListFavoritePoolsData> {
  meta?: {
    /** Timestamp of the request */
    timestamp?: string;
    /** Number of favorites returned */
    count?: number;
    /** Limit used */
    limit?: number;
    /** Offset used */
    offset?: number;
  };
}

/**
 * DELETE /api/v1/pools/uniswapv3/favorites/:chainId/:address - Response data
 *
 * Empty response body on success. Uses 204 No Content or 200 OK.
 */
export interface RemoveFavoritePoolData {
  /**
   * Always true on success
   */
  removed: boolean;
}

/**
 * DELETE /api/v1/pools/uniswapv3/favorites/:chainId/:address - Full response
 */
export interface RemoveFavoritePoolResponse extends ApiResponse<RemoveFavoritePoolData> {
  meta?: {
    /** Timestamp of the operation */
    timestamp?: string;
  };
}

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/**
 * Supported chain IDs for favorites
 */
const SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 10, 137, 56] as const;

/**
 * POST /api/v1/pools/uniswapv3/favorites - Request body validation
 */
export const AddFavoritePoolRequestSchema = z.object({
  chainId: z
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive')
    .refine(
      (id) => SUPPORTED_CHAIN_IDS.includes(id as (typeof SUPPORTED_CHAIN_IDS)[number]),
      (id) => ({
        message: `Chain ID ${id} is not supported. Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}`,
      })
    ),

  poolAddress: z
    .string()
    .min(1, 'Pool address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address format'),
});

/**
 * Inferred type from AddFavoritePoolRequestSchema
 */
export type AddFavoritePoolRequestValidated = z.infer<typeof AddFavoritePoolRequestSchema>;

/**
 * DELETE /api/v1/pools/uniswapv3/favorites/:chainId/:address - Path params validation
 */
export const RemoveFavoritePoolParamsSchema = z.object({
  chainId: z
    .string()
    .min(1, 'chainId is required')
    .regex(/^\d+$/, 'chainId must be a positive integer')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('chainId must be an integer')
        .positive('chainId must be positive')
    ),

  address: z
    .string()
    .min(1, 'Pool address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address format'),
});

/**
 * Inferred type from RemoveFavoritePoolParamsSchema
 */
export type RemoveFavoritePoolParamsValidated = z.infer<typeof RemoveFavoritePoolParamsSchema>;

/**
 * GET /api/v1/pools/uniswapv3/favorites - Query params validation
 */
export const ListFavoritePoolsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(100, 'Limit cannot exceed 100')
    ),

  offset: z
    .string()
    .optional()
    .default('0')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('Offset must be an integer')
        .min(0, 'Offset cannot be negative')
    ),
});

/**
 * Inferred type from ListFavoritePoolsQuerySchema
 */
export type ListFavoritePoolsQueryValidated = z.infer<typeof ListFavoritePoolsQuerySchema>;

// ============================================================================
// GENERIC (PROTOCOL-AGNOSTIC) ENDPOINT TYPES
// ============================================================================

/**
 * Supported protocols for favorites
 */
const SUPPORTED_PROTOCOLS = ['uniswapv3'] as const;

/**
 * DELETE /api/v1/pools/favorites - Query params
 *
 * Generic endpoint that routes to protocol-specific logic.
 */
export interface RemoveFavoritePoolQuery {
  /**
   * Protocol identifier
   * @example "uniswapv3"
   */
  protocol: string;

  /**
   * Chain ID where the pool is deployed
   * @example "1"
   */
  chainId: string;

  /**
   * Pool contract address
   * @example "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  address: string;
}

/**
 * DELETE /api/v1/pools/favorites - Query params validation
 *
 * Validates protocol, chainId, and address for the generic favorites endpoint.
 */
export const RemoveFavoritePoolQuerySchema = z.object({
  protocol: z
    .string()
    .min(1, 'Protocol is required')
    .refine(
      (p) => SUPPORTED_PROTOCOLS.includes(p as (typeof SUPPORTED_PROTOCOLS)[number]),
      (p) => ({
        message: `Protocol "${p}" is not supported. Supported: ${SUPPORTED_PROTOCOLS.join(', ')}`,
      })
    ),

  chainId: z
    .string()
    .min(1, 'chainId is required')
    .regex(/^\d+$/, 'chainId must be a positive integer')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('chainId must be an integer')
        .positive('chainId must be positive')
    ),

  address: z
    .string()
    .min(1, 'Pool address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address format'),
});

/**
 * Inferred type from RemoveFavoritePoolQuerySchema
 */
export type RemoveFavoritePoolQueryValidated = z.infer<typeof RemoveFavoritePoolQuerySchema>;

/**
 * POST /api/v1/pools/favorites - Request body
 *
 * Generic endpoint to add a pool to favorites with protocol specification.
 */
export interface GenericAddFavoritePoolRequest {
  /**
   * Protocol identifier
   * @example "uniswapv3"
   */
  protocol: string;

  /**
   * Chain ID where the pool is deployed
   * @example 1
   */
  chainId: number;

  /**
   * Pool contract address (EIP-55 checksummed or lowercase)
   * @example "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  poolAddress: string;
}

/**
 * POST /api/v1/pools/favorites - Request body validation
 */
export const GenericAddFavoritePoolRequestSchema = z.object({
  protocol: z
    .string()
    .min(1, 'Protocol is required')
    .refine(
      (p) => SUPPORTED_PROTOCOLS.includes(p as (typeof SUPPORTED_PROTOCOLS)[number]),
      (p) => ({
        message: `Protocol "${p}" is not supported. Supported: ${SUPPORTED_PROTOCOLS.join(', ')}`,
      })
    ),

  chainId: z
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive')
    .refine(
      (id) => SUPPORTED_CHAIN_IDS.includes(id as (typeof SUPPORTED_CHAIN_IDS)[number]),
      (id) => ({
        message: `Chain ID ${id} is not supported. Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}`,
      })
    ),

  poolAddress: z
    .string()
    .min(1, 'Pool address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address format'),
});

/**
 * Inferred type from GenericAddFavoritePoolRequestSchema
 */
export type GenericAddFavoritePoolRequestValidated = z.infer<typeof GenericAddFavoritePoolRequestSchema>;

/**
 * GET /api/v1/pools/favorites - Query params
 *
 * Generic endpoint to list favorite pools with optional protocol filter.
 */
export interface GenericListFavoritePoolsQuery {
  /**
   * Optional protocol filter
   *
   * If provided, only returns favorites for that protocol.
   * If omitted, returns favorites for all protocols.
   *
   * @example "uniswapv3"
   */
  protocol?: string;

  /**
   * Maximum number of results to return
   * @default 50
   * @max 100
   */
  limit?: number;

  /**
   * Offset for pagination
   * @default 0
   */
  offset?: number;
}

/**
 * GET /api/v1/pools/favorites - Query params validation
 */
export const GenericListFavoritePoolsQuerySchema = z.object({
  protocol: z
    .string()
    .optional()
    .refine(
      (p) => p === undefined || SUPPORTED_PROTOCOLS.includes(p as (typeof SUPPORTED_PROTOCOLS)[number]),
      (p) => ({
        message: `Protocol "${p}" is not supported. Supported: ${SUPPORTED_PROTOCOLS.join(', ')}`,
      })
    ),

  limit: z
    .string()
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(100, 'Limit cannot exceed 100')
    ),

  offset: z
    .string()
    .optional()
    .default('0')
    .transform((val) => parseInt(val, 10))
    .pipe(
      z
        .number()
        .int('Offset must be an integer')
        .min(0, 'Offset cannot be negative')
    ),
});

/**
 * Inferred type from GenericListFavoritePoolsQuerySchema
 */
export type GenericListFavoritePoolsQueryValidated = z.infer<typeof GenericListFavoritePoolsQuerySchema>;
