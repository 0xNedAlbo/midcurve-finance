/**
 * Generic Hedge Interface
 *
 * Type-safe hedge representation using mapped types pattern.
 * Follows the same architecture as Position<P>.
 */

import type { HedgeConfigMap, HedgeType } from './hedge-config.js';

/**
 * Generic Hedge interface
 *
 * Uses mapped types to ensure type-safe access to protocol-specific
 * config and state based on the hedge type.
 *
 * @template H - The hedge type (e.g., 'hyperliquid-perp')
 */
export interface Hedge<H extends HedgeType> {
  /** Unique identifier */
  id: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Owner user ID */
  userId: string;

  /** Linked position ID (required) */
  positionId: string;

  /** Hedge type identifier */
  hedgeType: H;

  /** Protocol identifier */
  protocol: string;

  // Financial data (bigint in TypeScript)

  /** Current notional value in quote units */
  notionalValue: bigint;

  /** Total cost basis */
  costBasis: bigint;

  /** Realized PnL */
  realizedPnl: bigint;

  /** Unrealized PnL */
  unrealizedPnl: bigint;

  /** Current APR (positive or negative, 0 if unavailable) */
  currentApr: number;

  // Lifecycle

  /** Whether the hedge is currently active */
  isActive: boolean;

  /** When the hedge was opened */
  openedAt: Date;

  /** When the hedge was closed (null if still open) */
  closedAt: Date | null;

  // Protocol-specific data (type-safe via mapped types)

  /** Immutable configuration */
  config: HedgeConfigMap[H]['config'];

  /** Mutable state */
  state: HedgeConfigMap[H]['state'];
}

// =============================================================================
// Type Aliases
// =============================================================================

/**
 * Hyperliquid Perpetual Hedge
 */
export type HyperliquidPerpHedge = Hedge<'hyperliquid-perp'>;

/**
 * Union of all hedge types
 */
export type AnyHedge = Hedge<HedgeType>;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for Hyperliquid Perpetual Hedge
 */
export function isHyperliquidPerpHedge(
  hedge: AnyHedge
): hedge is HyperliquidPerpHedge {
  return hedge.hedgeType === 'hyperliquid-perp';
}

/**
 * Assert that a hedge is of a specific type
 *
 * @throws Error if the hedge type doesn't match
 */
export function assertHyperliquidPerpHedge(
  hedge: AnyHedge
): asserts hedge is HyperliquidPerpHedge {
  if (!isHyperliquidPerpHedge(hedge)) {
    throw new Error(
      `Expected hyperliquid-perp hedge, got ${(hedge as AnyHedge).hedgeType}`
    );
  }
}

/**
 * Narrow a hedge to a specific type
 *
 * @throws Error if the hedge type doesn't match
 */
export function narrowHedgeType<H extends HedgeType>(
  hedge: AnyHedge,
  hedgeType: H
): Hedge<H> {
  if (hedge.hedgeType !== hedgeType) {
    throw new Error(
      `Expected ${hedgeType} hedge, got ${(hedge as AnyHedge).hedgeType}`
    );
  }
  return hedge as Hedge<H>;
}
