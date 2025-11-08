/**
 * Format Helpers - Wrapper utilities for position display
 *
 * High-level formatting functions for position values, PnL, fees, and APR.
 * Wraps the low-level fraction-format utilities with application-specific logic.
 */

import { formatCompactValue } from "./fraction-format";

/**
 * Formats a monetary value (in quote token units) with $ prefix
 * @param value - Bigint value as string (serialized from API)
 * @param decimals - Token decimals (default 18)
 * @returns Formatted string like "$12,450.00" or "$0.₍7₎1234…"
 */
export function formatCurrency(value: string, decimals: number = 18): string {
  const bigintValue = BigInt(value);
  const formatted = formatCompactValue(bigintValue, decimals);
  return `$${formatted}`;
}

/**
 * Formats a PnL value with +/- prefix and color indication
 * @param value - Bigint value as string (serialized from API)
 * @param decimals - Token decimals (default 18)
 * @returns Object with formatted string and color class
 */
export function formatPnL(
  value: string,
  decimals: number = 18
): { text: string; colorClass: string } {
  const bigintValue = BigInt(value);
  const formatted = formatCompactValue(
    bigintValue < 0n ? -bigintValue : bigintValue,
    decimals
  );

  if (bigintValue > 0n) {
    return {
      text: `+$${formatted}`,
      colorClass: "text-green-400",
    };
  } else if (bigintValue < 0n) {
    return {
      text: `-$${formatted}`,
      colorClass: "text-red-400",
    };
  } else {
    return {
      text: "$0.00",
      colorClass: "text-slate-400",
    };
  }
}

/**
 * Formats unclaimed fees (always positive)
 * @param value - Bigint value as string (serialized from API)
 * @param decimals - Token decimals (default 18)
 * @returns Formatted string like "$45.23"
 */
export function formatFees(value: string, decimals: number = 18): string {
  return formatCurrency(value, decimals);
}

/**
 * Formats a percentage value (e.g., APR, fee tier)
 * @param value - Percentage as number (e.g., 24.5 for 24.5%)
 * @param decimals - Number of decimal places (default 1)
 * @returns Formatted string like "24.5%" or "0.3%"
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Calculates estimated APR from position data (simplified version)
 *
 * Formula: APR = (unClaimedFees / costBasis) / timeElapsed * 365 days * 100
 *
 * Only calculates APR based on unclaimed fees (not total collected fees).
 * This shows the current earning rate of the position.
 *
 * Edge cases:
 * - If position is out of range: returns 0%
 * - If costBasis is 0: returns 0%
 * - If timeElapsed < 1 hour: returns 0% (insufficient data)
 * - If lastFeesCollectedAt is null: uses positionOpenedAt
 *
 * @param params - Position data for APR calculation
 * @returns Object with APR percentage and threshold status
 */
export function calculateAPR(params: {
  costBasis: string; // BigInt as string (quote token units)
  unClaimedFees: string; // BigInt as string (quote token units)
  lastFeesCollectedAt: string | null; // ISO timestamp or null
  positionOpenedAt: string; // ISO timestamp
  isInRange: boolean; // Whether position is currently in range
  decimals?: number; // Token decimals (default 18)
}): { apr: number; belowThreshold: boolean } {
  const {
    costBasis,
    unClaimedFees,
    lastFeesCollectedAt,
    positionOpenedAt,
    isInRange,
    decimals = 18,
  } = params;

  // Out of range positions don't earn fees
  if (!isInRange) {
    return { apr: 0, belowThreshold: false };
  }

  const costBasisBigInt = BigInt(costBasis);
  const feesBigInt = BigInt(unClaimedFees);

  // Can't calculate APR with zero cost basis
  if (costBasisBigInt === 0n) {
    return { apr: 0, belowThreshold: false };
  }

  // Calculate time elapsed since last collection (or position opened)
  const startTime = lastFeesCollectedAt
    ? new Date(lastFeesCollectedAt).getTime()
    : new Date(positionOpenedAt).getTime();
  const now = Date.now();
  const timeElapsedMs = now - startTime;

  // Need at least 5 minutes of data for meaningful APR
  // This prevents wild swings in the first few minutes but allows quick feedback
  const MIN_TIME_MS = 5 * 60 * 1000; // 5 minutes

  if (timeElapsedMs < MIN_TIME_MS) {
    return { apr: 0, belowThreshold: true };
  }

  // Convert to days
  const timeElapsedDays = timeElapsedMs / (1000 * 60 * 60 * 24);

  // Calculate APR: (unClaimedFees / costBasis) / time * 365 * 100
  // Use floating point for APR calculation (precision not critical for display)
  const denominator = 10n ** BigInt(decimals);

  const feesFloat = Number(feesBigInt) / Number(denominator);
  const costBasisFloat = Number(costBasisBigInt) / Number(denominator);

  const apr = (feesFloat / costBasisFloat / timeElapsedDays) * 365 * 100;

  // Cap at 9999% to avoid display issues with extreme values
  const cappedApr = Math.min(apr, 9999);

  return { apr: cappedApr, belowThreshold: false };
}

/**
 * Formats a token amount with symbol
 * @param value - Bigint value as string (serialized from API)
 * @param symbol - Token symbol (e.g., "ETH", "USDC")
 * @param decimals - Token decimals (default 18)
 * @returns Formatted string like "1,234.56 ETH"
 */
export function formatTokenAmount(
  value: string,
  symbol: string,
  decimals: number = 18
): string {
  const bigintValue = BigInt(value);
  const formatted = formatCompactValue(bigintValue, decimals);
  return `${formatted} ${symbol}`;
}

/**
 * Formats a Uniswap V3 fee tier to percentage
 * @param feeTier - Fee tier in basis points (e.g., 3000 = 0.3%)
 * @returns Formatted string like "0.3%" or "1%"
 */
export function formatFeeTier(feeTier: number): string {
  const percentage = feeTier / 10000;
  // Show 2 decimals for 0.01% and 0.05% tiers, 1 decimal for 0.3%, 0 decimals for 1%
  const decimals = feeTier === 100 || feeTier === 500 ? 2 : percentage < 1 ? 1 : 0;
  return formatPercentage(percentage, decimals);
}

/**
 * Formats USD values from subgraph/API (compact notation)
 *
 * Used for pool metrics like TVL, volume, fees.
 * Returns "N/A" for missing or zero values.
 *
 * @param usdString - USD value as string (from subgraph)
 * @returns Formatted string like "$123.4M", "$45.6K", or "N/A"
 *
 * @example
 * formatUSDValue("123456789.50") // "$123.5M"
 * formatUSDValue("12345.67")     // "$12.3K"
 * formatUSDValue("0")            // "N/A"
 * formatUSDValue(undefined)      // "N/A"
 */
export function formatUSDValue(usdString?: string): string {
  if (!usdString || usdString === '0') return 'N/A';

  const usdNum = parseFloat(usdString);

  if (isNaN(usdNum) || usdNum === 0) return 'N/A';

  // Billion
  if (usdNum >= 1e9) return `$${(usdNum / 1e9).toFixed(1)}B`;
  // Million
  if (usdNum >= 1e6) return `$${(usdNum / 1e6).toFixed(1)}M`;
  // Thousand
  if (usdNum >= 1e3) return `$${(usdNum / 1e3).toFixed(1)}K`;
  // Less than 1K
  return `$${usdNum.toFixed(2)}`;
}

/**
 * Formats protocol name for display
 * @param protocol - Protocol identifier (e.g., "uniswapv3", "orca")
 * @returns Human-readable protocol name (e.g., "Uniswap V3", "Orca")
 */
export function formatProtocolName(protocol: string): string {
  const protocolNames: Record<string, string> = {
    uniswapv3: 'Uniswap V3',
    // Future protocols:
    // orca: 'Orca',
    // raydium: 'Raydium',
    // pancakeswapv3: 'PancakeSwap V3',
  };
  return protocolNames[protocol] || protocol;
}
