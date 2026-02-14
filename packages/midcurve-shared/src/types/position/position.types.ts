/**
 * Position Types
 *
 * Type definitions for position protocol discrimination,
 * JSON serialization, and database row mapping.
 */

import type { UniswapV3Pool } from '../pool/index.js';
import type { PoolJSON, UniswapV3PoolRow } from '../pool/index.js';
import type { Erc20TokenRow } from '../token/index.js';

// ============================================================================
// PROTOCOL DISCRIMINATORS
// ============================================================================

/**
 * Supported position protocols.
 * Extensible for future protocols (orca, raydium, etc.)
 */
export type PositionProtocol = 'uniswapv3';

/**
 * Position types.
 * CL_TICKS = Concentrated liquidity with tick-based ranges
 */
export type PositionType = 'CL_TICKS';

// ============================================================================
// PNL SIMULATION
// ============================================================================

/**
 * Base simulation result for any position type.
 * Returned by simulatePnLAtPrice() on PositionInterface.
 */
export interface PnLSimulationResult {
  /** Position value at the simulated price (quote token units) */
  positionValue: bigint;
  /** PnL at the simulated price (quote token units) */
  pnlValue: bigint;
  /** PnL as percentage of cost basis */
  pnlPercent: number;
  /** Amount of base token held at this price (optional, provided by protocol-specific implementations) */
  baseTokenAmount?: bigint;
  /** Amount of quote token held at this price (optional, provided by protocol-specific implementations) */
  quoteTokenAmount?: bigint;
}

// ============================================================================
// JSON SERIALIZATION
// ============================================================================

/**
 * JSON representation of a Position for API responses.
 * All Date fields are ISO strings, all bigint fields are strings.
 */
export interface PositionJSON {
  id: string;
  positionHash: string;
  userId: string;
  protocol: PositionProtocol;
  positionType: PositionType;
  pool: PoolJSON;
  isToken0Quote: boolean;

  // PnL fields (bigint as string)
  currentValue: string;
  currentCostBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  realizedCashflow: string;
  unrealizedCashflow: string;

  // Fee fields
  collectedFees: string;
  unClaimedFees: string;
  lastFeesCollectedAt: string;
  totalApr: number | null;

  // Price range (bigint as string)
  priceRangeLower: string;
  priceRangeUpper: string;

  // Lifecycle
  positionOpenedAt: string;
  positionClosedAt: string | null;
  isActive: boolean;

  // Protocol-specific
  config: Record<string, unknown>;
  state: Record<string, unknown>;

  // Timestamps (ISO strings)
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

/**
 * Parameters for constructing a BasePosition.
 * Used by all position subclasses.
 */
export interface BasePositionParams {
  id: string;
  positionHash: string;
  userId: string;
  positionType: PositionType;
  pool: UniswapV3Pool;
  isToken0Quote: boolean;

  // PnL fields
  currentValue: bigint;
  currentCostBasis: bigint;
  realizedPnl: bigint;
  unrealizedPnl: bigint;
  realizedCashflow: bigint;
  unrealizedCashflow: bigint;

  // Fee fields
  collectedFees: bigint;
  unClaimedFees: bigint;
  lastFeesCollectedAt: Date;
  totalApr: number | null;

  // Price range
  priceRangeLower: bigint;
  priceRangeUpper: bigint;

  // Lifecycle
  positionOpenedAt: Date;
  positionClosedAt: Date | null;
  isActive: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * Database row interface for Position factory method.
 * Matches Prisma query result shape.
 */
export interface PositionRow {
  id: string;
  positionHash: string;
  userId: string;
  protocol: string;
  positionType: string;
  poolId: string;
  isToken0Quote: boolean;

  // PnL fields (Prisma returns bigint)
  currentValue: bigint;
  currentCostBasis: bigint;
  realizedPnl: bigint;
  unrealizedPnl: bigint;
  realizedCashflow: bigint;
  unrealizedCashflow: bigint;

  // Fee fields
  collectedFees: bigint;
  unClaimedFees: bigint;
  lastFeesCollectedAt: Date;
  totalApr: number | null;

  // Price range
  priceRangeLower: bigint;
  priceRangeUpper: bigint;

  // Lifecycle
  positionOpenedAt: Date;
  positionClosedAt: Date | null;
  isActive: boolean;

  // Protocol-specific (JSON columns)
  config: Record<string, unknown>;
  state: Record<string, unknown>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Included relation (from Prisma with include: { pool: { include: { token0: true, token1: true } } })
  pool?: UniswapV3PoolRow & {
    token0: Erc20TokenRow;
    token1: Erc20TokenRow;
  };
}
