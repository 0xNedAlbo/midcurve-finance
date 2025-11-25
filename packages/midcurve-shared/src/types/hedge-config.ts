/**
 * Hedge Configuration Map
 *
 * Maps hedge type identifiers to their protocol-specific config and state types.
 * Follows the same pattern as PositionConfigMap for positions.
 */

import type { HyperliquidPerpHedgeConfig } from './hyperliquid/hedge-config.js';
import type { HyperliquidPerpHedgeState } from './hyperliquid/hedge-state.js';

/**
 * Supported hedge types
 */
export type HedgeType = keyof HedgeConfigMap;

/**
 * Supported hedge protocols
 */
export type HedgeProtocol = 'hyperliquid';
// Future: | 'deribit' | 'gmx' | 'aave';

/**
 * Hedge Configuration Map
 *
 * Maps each hedge type to its config and state types.
 * Used for type-safe access to protocol-specific data.
 */
export interface HedgeConfigMap {
  'hyperliquid-perp': {
    config: HyperliquidPerpHedgeConfig;
    state: HyperliquidPerpHedgeState;
    protocol: 'hyperliquid';
  };
  // Future hedge types:
  // 'deribit-option': {
  //   config: DeribitOptionHedgeConfig;
  //   state: DeribitOptionHedgeState;
  //   protocol: 'deribit';
  // };
  // 'gmx-perp': {
  //   config: GmxPerpHedgeConfig;
  //   state: GmxPerpHedgeState;
  //   protocol: 'gmx';
  // };
}

/**
 * Get the protocol for a hedge type
 */
export function getHedgeProtocol<H extends HedgeType>(
  hedgeType: H
): HedgeConfigMap[H]['protocol'] {
  const protocolMap: Record<HedgeType, HedgeProtocol> = {
    'hyperliquid-perp': 'hyperliquid',
  };
  return protocolMap[hedgeType] as HedgeConfigMap[H]['protocol'];
}
