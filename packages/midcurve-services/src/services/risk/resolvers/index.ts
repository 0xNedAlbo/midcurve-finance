/**
 * Hedge Resolvers
 *
 * Protocol-specific resolvers for converting risk views to hedge parameters.
 */

// Types
export type { HedgeParams, HedgeResolver } from './types.js';

// Hyperliquid resolver
export {
  HyperliquidHedgeResolver,
  getHyperliquidMarket,
} from './hyperliquid-hedge-resolver.js';
export type { HyperliquidResolvedMarket } from './hyperliquid-hedge-resolver.js';
