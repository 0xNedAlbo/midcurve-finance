/**
 * HODL Position State
 *
 * Mutable state for HODL positions.
 * Tracks the current holdings (token balances and cost basis) in the basket.
 */

/**
 * Individual token holding within a HODL position
 *
 * Represents a single token's balance and cost basis in the basket.
 */
export interface HodlPositionHolding {
  /**
   * Token symbol for readability
   *
   * Stored for display purposes only - not used for calculations.
   * The tokenId (record key) is the authoritative identifier.
   *
   * @example "WETH", "USDC", "ARB"
   */
  tokenSymbol: string;

  /**
   * Current token balance in smallest units
   *
   * @example
   * // 1.5 WETH (18 decimals)
   * balance = 1_500000000000000000n
   *
   * // 1000 USDC (6 decimals)
   * balance = 1000_000000n
   */
  balance: bigint;

  /**
   * Average cost basis in quote token units
   *
   * Total capital invested in this token, denominated in quote token's smallest units.
   * Updated using average cost basis methodology on deposits/trades.
   *
   * @example
   * // Cost basis of 3000 USDC (6 decimals) for WETH holding
   * costBasis = 3000_000000n
   */
  costBasis: bigint;
}

/**
 * HODL Position State
 *
 * Contains all token holdings in the basket.
 * Each holding is keyed by the token's database ID.
 */
export interface HodlPositionState {
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
   *     tokenSymbol: "WETH",
   *     balance: 1_500000000000000000n,
   *     costBasis: 3000_000000n
   *   },
   *   "clxyz456_usdc": {
   *     tokenSymbol: "USDC",
   *     balance: 5000_000000n,
   *     costBasis: 5000_000000n
   *   }
   * }
   * ```
   */
  holdings: Record<string, HodlPositionHolding>;
}
