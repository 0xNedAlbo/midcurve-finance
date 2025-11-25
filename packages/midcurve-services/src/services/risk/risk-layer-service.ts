/**
 * Risk Layer Service
 *
 * Protocol-agnostic service for deriving risk pairs and
 * determining hedge eligibility from CL positions.
 */

import type {
  AnyPosition,
  PositionRiskPair,
  PositionRiskView,
  HedgeEligibility,
  AnyPool,
} from '@midcurve/shared';

import { RiskAssetRegistry } from './risk-asset-registry.js';

/**
 * Eligibility result with optional reason
 */
interface EligibilityResult {
  eligibility: HedgeEligibility;
  reason?: string;
}

/**
 * Risk Layer Service (Protocol-Agnostic)
 *
 * Derives economic risk views from CL positions.
 * NO protocol-specific hedge logic here - that belongs in resolvers.
 *
 * @example
 * const riskService = new RiskLayerService();
 * const riskView = riskService.buildPositionRiskView(position);
 * // { riskBase: 'ETH', riskQuote: 'USD', hedgeEligibility: 'simplePerp' }
 */
export class RiskLayerService {
  private registry: RiskAssetRegistry;

  constructor(registry?: RiskAssetRegistry) {
    this.registry = registry ?? RiskAssetRegistry.getInstance();
  }

  /**
   * Derive economic risk pair from a position
   *
   * Uses position.isToken0Quote to determine base/quote assignment,
   * then maps on-chain tokens to economic risk assets.
   *
   * @param position - Any CL position
   * @returns Economic risk pair with asset IDs and roles
   */
  deriveRiskPair(position: AnyPosition): PositionRiskPair {
    const pool = position.pool as AnyPool;

    // Get tokens based on user's quote/base assignment
    const baseToken = position.isToken0Quote ? pool.token1 : pool.token0;
    const quoteToken = position.isToken0Quote ? pool.token0 : pool.token1;

    // Map to risk assets
    const baseRisk = this.registry.getRiskAsset(
      baseToken.config.address,
      baseToken.config.chainId
    );
    const quoteRisk = this.registry.getRiskAsset(
      quoteToken.config.address,
      quoteToken.config.chainId
    );

    return {
      base: baseRisk.id,
      quote: quoteRisk.id,
      baseRole: baseRisk.role,
      quoteRole: quoteRisk.role,
    };
  }

  /**
   * Classify hedge eligibility for a risk pair
   *
   * Determines what type of hedging strategy is applicable
   * based on the economic role of base and quote assets.
   *
   * @param pair - Position risk pair
   * @returns Eligibility classification with reason if not eligible
   */
  classifyHedgeEligibility(pair: PositionRiskPair): EligibilityResult {
    const { base, quote, baseRole, quoteRole } = pair;

    // Case 1: Volatile base vs Stable quote (most common)
    // e.g., ETH/USD, BTC/USD
    // Can hedge with simple perpetual short
    if (baseRole === 'volatile' && quoteRole === 'stable') {
      return { eligibility: 'simplePerp' };
    }

    // Case 2: Stable base vs Volatile quote (inverted pair)
    // e.g., USDC/WETH pool where user chose WETH as quote
    // User measures value in ETH, has USD as base → they benefit when ETH rises
    // Would require LONG hedge, not short
    if (baseRole === 'stable' && quoteRole === 'volatile') {
      return {
        eligibility: 'none',
        reason: `Inverted pair (${base}/${quote}): base is stable, quote is volatile. Would require long hedge, not short.`,
      };
    }

    // Case 3: Volatile vs Volatile (e.g., ETH/BTC)
    // Requires multi-leg hedge strategy
    if (baseRole === 'volatile' && quoteRole === 'volatile') {
      return {
        eligibility: 'advanced',
        reason: `Volatile/volatile pair (${base}/${quote}): requires multi-leg hedge strategy.`,
      };
    }

    // Case 4: Stable vs Stable (e.g., USDC/DAI)
    // Minimal price risk, hedging not necessary
    if (baseRole === 'stable' && quoteRole === 'stable') {
      return {
        eligibility: 'none',
        reason: `Stable/stable pair (${base}/${quote}): minimal price risk, hedging not necessary.`,
      };
    }

    // Case 5: OTHER involved (unclassified asset)
    return {
      eligibility: 'none',
      reason: `Unclassified asset in pair (${base}/${quote}): cannot determine hedge strategy.`,
    };
  }

  /**
   * Build complete risk view for a position
   *
   * Combines risk pair derivation and eligibility classification
   * into a single, protocol-agnostic risk view.
   *
   * @param position - Any CL position
   * @returns Complete risk view
   */
  buildPositionRiskView(position: AnyPosition): PositionRiskView {
    const pair = this.deriveRiskPair(position);
    const { eligibility, reason } = this.classifyHedgeEligibility(pair);

    return {
      riskBase: pair.base,
      riskQuote: pair.quote,
      baseRole: pair.baseRole,
      quoteRole: pair.quoteRole,
      hedgeEligibility: eligibility,
      hedgeIneligibleReason: eligibility === 'none' ? reason : undefined,
    };
  }

  /**
   * Check if a position is eligible for simple perpetual hedge
   *
   * Convenience method for quick eligibility check.
   *
   * @param position - Any CL position
   * @returns true if can be hedged with single perpetual short
   */
  canHedgeWithPerp(position: AnyPosition): boolean {
    const view = this.buildPositionRiskView(position);
    return view.hedgeEligibility === 'simplePerp';
  }
}
