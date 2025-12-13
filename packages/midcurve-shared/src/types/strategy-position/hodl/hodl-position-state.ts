/**
 * HODL Position State
 *
 * Mutable state for HODL strategy positions.
 * Tracks the current token holdings in the basket.
 */

import type { HodlPositionHolding, HodlPositionHoldingJSON } from './hodl-position-holding.js';
import { holdingFromJSON, holdingToJSON } from './hodl-position-holding.js';

/**
 * HODL Position State Interface
 *
 * Contains all token holdings in the basket.
 * Each holding is keyed by the token's database ID.
 */
export interface HodlPositionStateData {
  /**
   * Token holdings in the basket
   *
   * Map of tokenId → HodlPositionHolding.
   * The tokenId is the database-generated token ID (cuid).
   *
   * @example
   * ```typescript
   * {
   *   "clxyz123_weth": {
   *     tokenHash: "erc20:1:0xC02a...",
   *     tokenSymbol: "WETH",
   *     balance: 1_500000000000000000n
   *   },
   *   "clxyz456_usdc": {
   *     tokenHash: "erc20:1:0xA0b8...",
   *     tokenSymbol: "USDC",
   *     balance: 5000_000000n
   *   }
   * }
   * ```
   */
  holdings: Map<string, HodlPositionHolding>;
}

/**
 * HODL Position State Class
 *
 * Provides methods for serialization and state management.
 */
export class HodlPositionState implements HodlPositionStateData {
  readonly holdings: Map<string, HodlPositionHolding>;

  constructor(holdings: Map<string, HodlPositionHolding>) {
    this.holdings = holdings;
  }

  /**
   * Create an empty state with no holdings
   */
  static empty(): HodlPositionState {
    return new HodlPositionState(new Map());
  }

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): Record<string, unknown> {
    const holdingsObj: Record<string, HodlPositionHoldingJSON> = {};
    for (const [tokenId, holding] of this.holdings) {
      holdingsObj[tokenId] = holdingToJSON(holding);
    }
    return { holdings: holdingsObj };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: Record<string, unknown>): HodlPositionState {
    const holdings = new Map<string, HodlPositionHolding>();
    const holdingsObj = json.holdings as Record<string, HodlPositionHoldingJSON>;

    if (holdingsObj) {
      for (const [tokenId, holdingJson] of Object.entries(holdingsObj)) {
        holdings.set(tokenId, holdingFromJSON(holdingJson));
      }
    }

    return new HodlPositionState(holdings);
  }

  /**
   * Get the number of tokens in the basket
   */
  getTokenCount(): number {
    return this.holdings.size;
  }

  /**
   * Get a specific holding by token ID
   */
  getHolding(tokenId: string): HodlPositionHolding | undefined {
    return this.holdings.get(tokenId);
  }

  /**
   * Check if a token is held in the basket
   */
  hasToken(tokenId: string): boolean {
    return this.holdings.has(tokenId);
  }

  /**
   * Get all token IDs in the basket
   */
  getTokenIds(): string[] {
    return Array.from(this.holdings.keys());
  }

  /**
   * Get all holdings as an array
   */
  getHoldingsArray(): HodlPositionHolding[] {
    return Array.from(this.holdings.values());
  }
}
