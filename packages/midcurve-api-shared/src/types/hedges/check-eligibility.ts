/**
 * Hedge Eligibility API Types
 *
 * Types and schemas for the check-eligibility endpoint.
 */

import { z } from 'zod';
import type {
  RiskAssetId,
  RiskAssetRole,
  HedgeEligibility,
} from '@midcurve/shared';

// =============================================================================
// Query Parameters
// =============================================================================

/**
 * Query params schema for check-eligibility endpoint
 *
 * @example
 * GET /api/v1/hedges/check-eligibility?position=uniswapv3/8453/5374877
 */
export const CheckHedgeEligibilityQuerySchema = z.object({
  position: z
    .string()
    .regex(
      /^[a-z0-9]+\/\d+\/\d+$/,
      'Position must be in format: protocol/chainId/nftId'
    ),
});

export type CheckHedgeEligibilityQuery = z.infer<
  typeof CheckHedgeEligibilityQuerySchema
>;

// =============================================================================
// Response Types
// =============================================================================

/**
 * Risk view information in API response
 *
 * Simplified view of the position's economic risk classification.
 */
export interface RiskViewResponse {
  /** Economic base asset (e.g., ETH, BTC) */
  riskBase: RiskAssetId;

  /** Economic quote asset (e.g., USD) */
  riskQuote: RiskAssetId;

  /** Base asset role (volatile, stable, other) */
  baseRole: RiskAssetRole;

  /** Quote asset role (volatile, stable, other) */
  quoteRole: RiskAssetRole;
}

/**
 * Live market data from the hedge exchange
 *
 * Optional data for display purposes - may be unavailable if API fails.
 */
export interface HedgeMarketData {
  /** Current mark price (e.g., "3150.50") */
  markPx: string;

  /** Current 8-hour funding rate (e.g., "0.0001" = 0.01%) */
  fundingRate: string;

  /** Maximum allowed leverage for this market */
  maxLeverage: number;

  /** Size decimal places for orders */
  szDecimals: number;

  /** Whether only isolated margin is allowed */
  onlyIsolated?: boolean;
}

/**
 * Hedge market information when position is eligible
 *
 * Contains the protocol-specific market parameters for opening a hedge.
 */
export interface HedgeMarketResponse {
  /** Hedge protocol (e.g., "hyperliquid") */
  protocol: string;

  /** Coin symbol on the exchange (e.g., "ETH", "BTC") */
  coin: string;

  /** Market symbol (e.g., "ETH-USD") */
  market: string;

  /** Quote currency (e.g., "USD") */
  quote: string;

  /** Live market data (optional for graceful degradation) */
  marketData?: HedgeMarketData;
}

/**
 * Check hedge eligibility response
 *
 * Returns eligibility status, risk classification, and market info if eligible.
 *
 * @example Eligible response
 * {
 *   eligible: true,
 *   eligibility: "simplePerp",
 *   riskView: { riskBase: "BTC", riskQuote: "USD", baseRole: "volatile", quoteRole: "stable" },
 *   hedgeMarket: { protocol: "hyperliquid", coin: "BTC", market: "BTC-USD", quote: "USD" }
 * }
 *
 * @example Ineligible response
 * {
 *   eligible: false,
 *   eligibility: "none",
 *   riskView: { riskBase: "ETH", riskQuote: "BTC", baseRole: "volatile", quoteRole: "volatile" },
 *   hedgeMarket: null,
 *   reason: "Volatile/volatile pair (ETH/BTC): requires multi-leg hedge strategy."
 * }
 */
export interface CheckHedgeEligibilityResponse {
  /** Whether the position can be hedged with simple perp */
  eligible: boolean;

  /** Eligibility classification */
  eligibility: HedgeEligibility;

  /** Risk view with asset classifications */
  riskView: RiskViewResponse;

  /** Hedge market info (null if not eligible) */
  hedgeMarket: HedgeMarketResponse | null;

  /** Reason if not eligible */
  reason?: string;
}
