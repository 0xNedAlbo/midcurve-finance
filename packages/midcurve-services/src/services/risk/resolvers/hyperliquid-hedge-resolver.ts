/**
 * Hyperliquid Hedge Resolver
 *
 * Converts PositionRiskView into Hyperliquid-specific parameters.
 * Handles the mapping from economic risk assets to Hyperliquid coin symbols.
 */

import type { PositionRiskView, RiskAssetId } from '@midcurve/shared';
import type { HedgeResolver, HedgeParams } from './types.js';

/**
 * Hyperliquid resolved market parameters
 *
 * Contains market information derived from a risk view.
 * Different from HyperliquidHedgeParams in @midcurve/shared which is
 * for hedge configuration (target notional, leverage, etc.).
 */
export interface HyperliquidResolvedMarket {
  /** Coin symbol on Hyperliquid (e.g., "ETH", "BTC") */
  coin: string;

  /** Market symbol (e.g., "ETH-USD") */
  market: string;

  /** Quote currency (always "USD" for Hyperliquid perps) */
  quote: string;
}

/**
 * RiskAssetId → Hyperliquid coin symbol mapping
 *
 * Maps economic risk asset IDs to Hyperliquid perpetual coin symbols.
 * Only assets with Hyperliquid markets are included.
 */
const RISK_ASSET_TO_HL_COIN: Partial<Record<RiskAssetId, string>> = {
  ETH: 'ETH',
  BTC: 'BTC',
  SOL: 'SOL',
  // Add more as Hyperliquid adds markets:
  // ARB: 'ARB',
  // OP: 'OP',
  // MATIC: 'MATIC',
  // AVAX: 'AVAX',
  // etc.
};

/**
 * Hyperliquid Hedge Resolver
 *
 * Implements HedgeResolver for Hyperliquid perpetual markets.
 * Converts protocol-agnostic risk views into Hyperliquid-specific parameters.
 *
 * @example
 * const resolver = new HyperliquidHedgeResolver();
 * const params = resolver.resolve(riskView);
 * // params = { protocol: 'hyperliquid', data: { coin: 'ETH', market: 'ETH-USD', quote: 'USD' } }
 */
export class HyperliquidHedgeResolver implements HedgeResolver {
  readonly protocol = 'hyperliquid';

  /**
   * Check if Hyperliquid has a perpetual market for this risk asset
   *
   * @param riskAssetId - Economic risk asset identifier
   * @returns true if Hyperliquid has a perp market for this asset
   */
  canResolve(riskAssetId: RiskAssetId): boolean {
    return riskAssetId in RISK_ASSET_TO_HL_COIN;
  }

  /**
   * Get Hyperliquid coin symbol for a risk asset
   *
   * @param riskAssetId - Economic risk asset identifier
   * @returns Hyperliquid coin symbol or undefined if not supported
   */
  getCoin(riskAssetId: RiskAssetId): string | undefined {
    return RISK_ASSET_TO_HL_COIN[riskAssetId];
  }

  /**
   * Get Hyperliquid market symbol for a risk asset
   *
   * @param riskAssetId - Economic risk asset identifier
   * @returns Market symbol (e.g., "ETH-USD") or undefined if not supported
   */
  getMarket(riskAssetId: RiskAssetId): string | undefined {
    const coin = this.getCoin(riskAssetId);
    return coin ? `${coin}-USD` : undefined;
  }

  /**
   * Resolve full hedge parameters from risk view
   *
   * Only resolves for positions eligible for simple perp hedge
   * and where Hyperliquid has a market for the base asset.
   *
   * @param riskView - Protocol-agnostic risk view
   * @returns Hyperliquid hedge parameters, or null if not resolvable
   */
  resolve(riskView: PositionRiskView): HedgeParams | null {
    // Only resolve simplePerp eligible positions
    if (riskView.hedgeEligibility !== 'simplePerp') {
      return null;
    }

    // Check if we have a Hyperliquid market for the base asset
    const coin = this.getCoin(riskView.riskBase);
    if (!coin) {
      return null;
    }

    const hlParams: HyperliquidResolvedMarket = {
      coin,
      market: `${coin}-USD`,
      quote: 'USD',
    };

    return {
      protocol: this.protocol,
      data: hlParams,
    };
  }
}

/**
 * Helper: Get Hyperliquid market from a risk view
 *
 * Convenience function that creates a resolver, resolves the risk view,
 * and returns the typed Hyperliquid market parameters.
 *
 * @param riskView - Protocol-agnostic risk view
 * @returns Hyperliquid market parameters, or null if not resolvable
 *
 * @example
 * const riskService = new RiskLayerService();
 * const riskView = riskService.buildPositionRiskView(position);
 * const hlMarket = getHyperliquidMarket(riskView);
 * if (hlMarket) {
 *   console.log(`Hedge on: ${hlMarket.market}`); // "ETH-USD"
 * }
 */
export function getHyperliquidMarket(
  riskView: PositionRiskView
): HyperliquidResolvedMarket | null {
  const resolver = new HyperliquidHedgeResolver();
  const result = resolver.resolve(riskView);
  return result?.data as HyperliquidResolvedMarket | null;
}
