/**
 * Risk Pair and Risk View Types
 *
 * Types for representing economic risk exposure of CL positions
 * and determining hedge eligibility.
 */

import type { RiskAssetId, RiskAssetRole } from './risk-asset.js';

/**
 * Economic risk pair derived from a CL position
 *
 * Normalizes pool token orientation into consistent base/quote
 * using the position's isToken0Quote flag.
 *
 * @example
 * // WETH/USDC pool with USDC as quote
 * { base: 'ETH', quote: 'USD', baseRole: 'volatile', quoteRole: 'stable' }
 */
export interface PositionRiskPair {
  /** Economic base asset (the risky/volatile asset) */
  base: RiskAssetId;

  /** Economic quote asset (the reference/stable asset) */
  quote: RiskAssetId;

  /** Base asset role classification */
  baseRole: RiskAssetRole;

  /** Quote asset role classification */
  quoteRole: RiskAssetRole;
}

/**
 * Hedge eligibility classification
 *
 * Determines what type of hedge strategy is applicable:
 * - none: Cannot be hedged (exotic pair or no market)
 * - simplePerp: Can hedge with single perpetual short
 * - advanced: Requires multi-leg strategy (e.g., volatile/volatile pairs)
 */
export type HedgeEligibility = 'none' | 'simplePerp' | 'advanced';

/**
 * Complete risk view for a position (protocol-agnostic)
 *
 * Computed on-demand, not stored in database.
 * Contains all information needed to determine hedging options.
 *
 * @example
 * // ETH/USD position eligible for simple perp hedge
 * {
 *   riskBase: 'ETH',
 *   riskQuote: 'USD',
 *   baseRole: 'volatile',
 *   quoteRole: 'stable',
 *   hedgeEligibility: 'simplePerp'
 * }
 */
export interface PositionRiskView {
  /** Economic base asset */
  riskBase: RiskAssetId;

  /** Economic quote asset */
  riskQuote: RiskAssetId;

  /** Base asset role */
  baseRole: RiskAssetRole;

  /** Quote asset role */
  quoteRole: RiskAssetRole;

  /** Hedge eligibility classification */
  hedgeEligibility: HedgeEligibility;

  /** Reason if hedging not possible (only when eligibility is 'none') */
  hedgeIneligibleReason?: string;
}
