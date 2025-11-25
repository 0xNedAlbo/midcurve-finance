/**
 * Hedge Resolver Types
 *
 * Interface for protocol-specific hedge parameter resolution.
 * Each hedging protocol (Hyperliquid, Deribit, GMX, etc.) implements this.
 */

import type { PositionRiskView, RiskAssetId } from '@midcurve/shared';

/**
 * Protocol-specific hedge parameters
 *
 * Generic wrapper for protocol-specific hedge data.
 * The `data` field contains protocol-specific parameters.
 */
export interface HedgeParams {
  /** Protocol identifier (e.g., 'hyperliquid', 'deribit') */
  protocol: string;

  /** Protocol-specific data (typed by each resolver) */
  data: unknown;
}

/**
 * Hedge Resolver Interface
 *
 * Each hedging protocol implements this interface to convert
 * a PositionRiskView into protocol-specific parameters.
 *
 * @example
 * class HyperliquidHedgeResolver implements HedgeResolver {
 *   readonly protocol = 'hyperliquid';
 *
 *   canResolve(riskAssetId: RiskAssetId): boolean {
 *     return riskAssetId === 'ETH' || riskAssetId === 'BTC';
 *   }
 *
 *   resolve(riskView: PositionRiskView): HedgeParams | null {
 *     // Return Hyperliquid-specific parameters
 *   }
 * }
 */
export interface HedgeResolver {
  /** Protocol identifier */
  readonly protocol: string;

  /**
   * Check if this resolver can handle the given risk asset
   *
   * @param riskAssetId - Economic risk asset identifier
   * @returns true if the protocol has a market for this asset
   */
  canResolve(riskAssetId: RiskAssetId): boolean;

  /**
   * Resolve hedge parameters from risk view
   *
   * @param riskView - Protocol-agnostic risk view
   * @returns Protocol-specific hedge parameters, or null if not resolvable
   */
  resolve(riskView: PositionRiskView): HedgeParams | null;
}
