/**
 * Decimal conversion utilities for cross-token arithmetic
 *
 * These utilities enable normalization of token values across different
 * decimal precisions, essential for cross-platform metrics aggregation.
 */

/**
 * Standard decimals for basic currencies
 *
 * All basic currencies (USD, ETH, BTC) use 18 decimals to maintain
 * maximum precision when aggregating values from different platforms.
 */
export const BASIC_CURRENCY_DECIMALS = 18;

/**
 * Convert a bigint value from source decimals to target decimals
 *
 * @param value - Value in source token's smallest units
 * @param sourceDecimals - Decimals of source token (e.g., 6 for USDC)
 * @param targetDecimals - Decimals of target token (e.g., 18 for ETH)
 * @returns Value in target token's smallest units
 *
 * @example
 * // Convert 100 USDC (6 decimals) to 18 decimals
 * convertDecimals(100_000_000n, 6, 18);
 * // Returns: 100_000_000_000_000_000_000n (100 * 10^18)
 *
 * @example
 * // Convert 1 ETH (18 decimals) to 6 decimals (lossy)
 * convertDecimals(1_000_000_000_000_000_000n, 18, 6);
 * // Returns: 1_000_000n (1 * 10^6)
 */
export function convertDecimals(
  value: bigint,
  sourceDecimals: number,
  targetDecimals: number
): bigint {
  if (sourceDecimals === targetDecimals) {
    return value;
  }

  const decimalDiff = targetDecimals - sourceDecimals;

  if (decimalDiff > 0) {
    // Scale up (e.g., 6 -> 18 decimals)
    return value * 10n ** BigInt(decimalDiff);
  } else {
    // Scale down (e.g., 18 -> 6 decimals) - truncates (loses precision)
    return value / 10n ** BigInt(-decimalDiff);
  }
}

/**
 * Normalize a value to basic currency decimals (18)
 *
 * This is the primary function used when aggregating position metrics
 * from different platforms with varying decimal precisions.
 *
 * @param value - Value in platform token's smallest units
 * @param tokenDecimals - Decimals of the platform token
 * @returns Value normalized to 18 decimals
 *
 * @example
 * // Normalize 100 USDC (6 decimals) to basic currency
 * normalizeToBasicCurrencyDecimals(100_000_000n, 6);
 * // Returns: 100_000_000_000_000_000_000n
 *
 * @example
 * // ETH values (18 decimals) pass through unchanged
 * normalizeToBasicCurrencyDecimals(1_000_000_000_000_000_000n, 18);
 * // Returns: 1_000_000_000_000_000_000n
 */
export function normalizeToBasicCurrencyDecimals(
  value: bigint,
  tokenDecimals: number
): bigint {
  return convertDecimals(value, tokenDecimals, BASIC_CURRENCY_DECIMALS);
}

/**
 * Convert a value from basic currency decimals (18) to target decimals
 *
 * Used when displaying aggregated values in a specific token's format.
 *
 * @param value - Value in basic currency units (18 decimals)
 * @param targetDecimals - Decimals of the target token
 * @returns Value in target token's smallest units
 *
 * @example
 * // Convert basic currency value to USDC display format
 * fromBasicCurrencyDecimals(100_000_000_000_000_000_000n, 6);
 * // Returns: 100_000_000n (100 USDC)
 */
export function fromBasicCurrencyDecimals(
  value: bigint,
  targetDecimals: number
): bigint {
  return convertDecimals(value, BASIC_CURRENCY_DECIMALS, targetDecimals);
}
