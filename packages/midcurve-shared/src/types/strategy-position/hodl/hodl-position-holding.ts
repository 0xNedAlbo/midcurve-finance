/**
 * HODL Position Holding
 *
 * Represents a single token holding within a HODL position basket.
 */

/**
 * Individual token holding within a HODL position
 *
 * Represents a single token's balance in the basket.
 * Cost basis is derived from ledger event aggregation, not stored here.
 */
export interface HodlPositionHolding {
  /**
   * Token hash for readability/logging
   *
   * Format: "erc20:chainId:address"
   * @example "erc20:1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
   */
  tokenHash: string;

  /**
   * Token symbol for display purposes
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
}

/**
 * JSON-serializable representation of a holding
 */
export interface HodlPositionHoldingJSON {
  tokenHash: string;
  tokenSymbol: string;
  balance: string; // bigint as string
}

/**
 * Convert holding to JSON-safe representation
 */
export function holdingToJSON(holding: HodlPositionHolding): HodlPositionHoldingJSON {
  return {
    tokenHash: holding.tokenHash,
    tokenSymbol: holding.tokenSymbol,
    balance: holding.balance.toString(),
  };
}

/**
 * Parse holding from JSON representation
 */
export function holdingFromJSON(json: HodlPositionHoldingJSON): HodlPositionHolding {
  return {
    tokenHash: json.tokenHash,
    tokenSymbol: json.tokenSymbol,
    balance: BigInt(json.balance),
  };
}
