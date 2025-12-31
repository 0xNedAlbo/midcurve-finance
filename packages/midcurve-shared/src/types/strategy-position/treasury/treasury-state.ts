/**
 * Treasury State
 *
 * Mutable state for Treasury strategy positions.
 * Tracks the current token holdings in the basket.
 */

import type { TreasuryHolding, TreasuryHoldingJSON } from './treasury-holding.js';
import { holdingFromJSON, holdingToJSON } from './treasury-holding.js';

/**
 * Treasury State Interface
 *
 * Contains all token holdings in the basket.
 * Each holding is keyed by the token's database ID.
 */
export interface TreasuryStateData {
  /**
   * Token holdings in the basket
   *
   * Map of tokenId → TreasuryHolding.
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
  holdings: Map<string, TreasuryHolding>;
}

/**
 * Treasury State Class
 *
 * Provides methods for serialization and state management.
 */
export class TreasuryState implements TreasuryStateData {
  readonly holdings: Map<string, TreasuryHolding>;

  constructor(holdings: Map<string, TreasuryHolding>) {
    this.holdings = holdings;
  }

  /**
   * Create an empty state with no holdings
   */
  static empty(): TreasuryState {
    return new TreasuryState(new Map());
  }

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): Record<string, unknown> {
    const holdingsObj: Record<string, TreasuryHoldingJSON> = {};
    for (const [tokenId, holding] of this.holdings) {
      holdingsObj[tokenId] = holdingToJSON(holding);
    }
    return { holdings: holdingsObj };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: Record<string, unknown>): TreasuryState {
    const holdings = new Map<string, TreasuryHolding>();
    const holdingsObj = json.holdings as Record<string, TreasuryHoldingJSON>;

    if (holdingsObj) {
      for (const [tokenId, holdingJson] of Object.entries(holdingsObj)) {
        holdings.set(tokenId, holdingFromJSON(holdingJson));
      }
    }

    return new TreasuryState(holdings);
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
  getHolding(tokenId: string): TreasuryHolding | undefined {
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
  getHoldingsArray(): TreasuryHolding[] {
    return Array.from(this.holdings.values());
  }
}
