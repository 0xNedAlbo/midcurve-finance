/**
 * Market ID Registry
 *
 * Maps market IDs (keccak256 hashes) to human-readable base/quote pairs.
 * Market IDs are computed as: keccak256(abi.encodePacked(base, "/", quote))
 *
 * This registry is used to:
 * 1. Look up the symbol for a given market ID (when processing subscriptions)
 * 2. Compute market IDs for known trading pairs
 * 3. Register new markets at runtime
 */

import { keccak256, encodePacked } from 'viem';

export interface MarketInfo {
  base: string;
  quote: string;
}

// Pre-computed market IDs for known markets
// These are computed once at module load time
const KNOWN_MARKETS: Map<string, MarketInfo> = new Map();

/**
 * Compute the market ID for a given base/quote pair
 * Matches the Solidity: keccak256(abi.encodePacked(base, "/", quote))
 */
export function computeMarketId(base: string, quote: string): `0x${string}` {
  return keccak256(encodePacked(['string', 'string', 'string'], [base, '/', quote]));
}

/**
 * Get market info (base/quote) for a given market ID
 * Returns null if the market ID is not registered
 */
export function getMarketInfo(marketId: string): MarketInfo | null {
  return KNOWN_MARKETS.get(marketId.toLowerCase()) ?? null;
}

/**
 * Register a new market and return its computed ID
 * This adds the market to the registry for future lookups
 */
export function registerMarket(base: string, quote: string): `0x${string}` {
  const id = computeMarketId(base, quote);
  KNOWN_MARKETS.set(id.toLowerCase(), { base, quote });
  return id;
}

/**
 * Check if a market ID is registered
 */
export function isMarketRegistered(marketId: string): boolean {
  return KNOWN_MARKETS.has(marketId.toLowerCase());
}

/**
 * Get all registered markets
 */
export function getAllMarkets(): Array<{ marketId: string; info: MarketInfo }> {
  return Array.from(KNOWN_MARKETS.entries()).map(([marketId, info]) => ({
    marketId,
    info,
  }));
}

/**
 * Initialize the registry with common markets
 * Called at module load time
 */
function initializeKnownMarkets(): void {
  // Major crypto pairs
  registerMarket('ETH', 'USD');
  registerMarket('BTC', 'USD');
  registerMarket('SOL', 'USD');
  registerMarket('ARB', 'USD');
  registerMarket('OP', 'USD');
  registerMarket('MATIC', 'USD');
  registerMarket('AVAX', 'USD');
  registerMarket('LINK', 'USD');
  registerMarket('UNI', 'USD');
  registerMarket('AAVE', 'USD');

  // Stablecoin pairs
  registerMarket('ETH', 'USDC');
  registerMarket('ETH', 'USDT');
  registerMarket('BTC', 'USDC');
  registerMarket('BTC', 'USDT');

  // Cross pairs
  registerMarket('ETH', 'BTC');
}

// Initialize on module load
initializeKnownMarkets();
