/**
 * PoolPrice Types
 *
 * Type definitions for pool price data structures.
 * Provides PoolPriceProtocol discriminator and serialization types.
 */

// ============================================================================
// DISCRIMINATORS
// ============================================================================

/**
 * Pool price protocol identifier
 * Derived from supported DEX protocols.
 * Extensible for future protocols (orca, raydium, etc.)
 */
export type PoolPriceProtocol = 'uniswapv3';

// ============================================================================
// JSON SERIALIZATION
// ============================================================================

/**
 * JSON representation of a PoolPrice for API responses.
 * All Date fields converted to ISO 8601 strings.
 * All bigint fields converted to strings.
 */
export interface PoolPriceJSON {
  id: string;
  protocol: PoolPriceProtocol;
  poolId: string;
  timestamp: string;
  token1PricePerToken0: string;
  token0PricePerToken1: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

/**
 * Base parameters for constructing any PoolPrice.
 * Extended by protocol-specific params (UniswapV3PoolPriceParams, etc.)
 */
export interface BasePoolPriceParams {
  id: string;
  poolId: string;
  timestamp: Date;
  token1PricePerToken0: bigint;
  token0PricePerToken1: bigint;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * Database row interface for PoolPrice factory method.
 * Maps to Prisma PoolPrice model output.
 */
export interface PoolPriceRow {
  id: string;
  protocol: string;
  poolId: string;
  timestamp: Date;
  token1PricePerToken0: bigint;
  token0PricePerToken1: bigint;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
