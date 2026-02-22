/**
 * Pool Types
 *
 * Type definitions for pool data structures.
 * Provides Protocol discriminator and serialization types.
 */

import type { TokenInterface, TokenJSON, TokenRow } from '../token/index.js';

// ============================================================================
// DISCRIMINATORS
// ============================================================================

/**
 * Protocol identifier
 * Derived from supported DEX protocols.
 * Extensible for future protocols (orca, raydium, etc.)
 */
export type Protocol = 'uniswapv3';

// ============================================================================
// JSON SERIALIZATION
// ============================================================================

/**
 * JSON representation of a Pool for API responses.
 * All Date fields converted to ISO 8601 strings.
 * Token references are fully serialized.
 */
export interface PoolJSON {
  id: string;
  protocol: Protocol;
  token0: TokenJSON;
  token1: TokenJSON;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

/**
 * Base parameters for constructing any Pool.
 * Extended by protocol-specific params (UniswapV3PoolParams, etc.)
 */
export interface BasePoolParams {
  id: string;
  token0: TokenInterface;
  token1: TokenInterface;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * Database row interface for Pool factory method.
 * Maps to Prisma Pool model output.
 * token0 and token1 are optional for cases where they're fetched separately.
 */
export interface PoolRow {
  id: string;
  protocol: string;
  token0Id: string;
  token1Id: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Included token0 relation (from Prisma with include)
   * Optional - may be fetched separately
   */
  token0?: TokenRow;
  /**
   * Included token1 relation (from Prisma with include)
   * Optional - may be fetched separately
   */
  token1?: TokenRow;
}
