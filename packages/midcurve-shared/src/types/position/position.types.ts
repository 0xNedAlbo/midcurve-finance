/**
 * Position Types
 *
 * Type definitions for position protocol discrimination,
 * JSON serialization, and database row mapping.
 */

import type { PoolJSON } from '../pool/index.js';
import type { TokenInterface } from '../token/index.js';

// ============================================================================
// PROTOCOL DISCRIMINATORS
// ============================================================================

/**
 * Supported position protocols.
 * Extensible for future protocols (orca, raydium, etc.)
 */
export type PositionProtocol = 'uniswapv3';

/**
 * Supported position types.
 * Describes the category of DeFi position (not the protocol).
 */
export type PositionType = 'LP_CONCENTRATED';

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
  type: string;
  pool: PoolJSON;
  isToken0Quote: boolean;

  // PnL fields (bigint as string)
  currentValue: string;
  costBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  realizedCashflow: string;
  unrealizedCashflow: string;

  // Yield fields
  collectedYield: string;
  unclaimedYield: string;
  lastYieldClaimedAt: string;

  // APR fields
  baseApr: number | null;
  rewardApr: number | null;
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
  type: string;
  token0: TokenInterface;
  token1: TokenInterface;

  // PnL fields
  currentValue: bigint;
  costBasis: bigint;
  realizedPnl: bigint;
  unrealizedPnl: bigint;
  realizedCashflow: bigint;
  unrealizedCashflow: bigint;

  // Yield fields
  collectedYield: bigint;
  unclaimedYield: bigint;
  lastYieldClaimedAt: Date;

  // APR fields
  baseApr: number | null;
  rewardApr: number | null;
  totalApr: number | null;

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
  type: string;

  // PnL fields (Prisma returns bigint)
  currentValue: bigint;
  costBasis: bigint;
  realizedPnl: bigint;
  unrealizedPnl: bigint;
  realizedCashflow: bigint;
  unrealizedCashflow: bigint;

  // Yield fields
  collectedYield: bigint;
  unclaimedYield: bigint;
  lastYieldClaimedAt: Date;

  // APR fields
  baseApr: number | null;
  rewardApr: number | null;
  totalApr: number | null;

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
}
