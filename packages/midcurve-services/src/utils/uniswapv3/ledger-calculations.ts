/**
 * Uniswap V3 Position Ledger Calculations
 *
 * Financial calculation utilities for position ledger event processing.
 * These functions support PnL tracking, cost basis management, fee separation,
 * and token value calculations for concentrated liquidity positions.
 *
 * All functions are pure (no side effects) and use BigInt for precision.
 * All monetary values are in smallest token units (wei, micro-USDC, etc.).
 *
 * Design Principles:
 * - Pure functions with no state
 * - BigInt throughout (no precision loss)
 * - Smallest units (no decimal conversions)
 * - Type-safe with explicit inputs/outputs
 * - Reuse existing shared utilities where possible
 *
 * @module ledger-calculations
 */

import {
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '@midcurve/shared';

// ============================================================================
// PRICE CALCULATIONS
// ============================================================================

/**
 * Calculate pool price in quote token units
 *
 * Converts sqrtPriceX96 to human-meaningful price: quote token units per 1 base token.
 *
 * Formula:
 * - If token0 is quote: price = 1 token1 (base) costs X token0 (quote)
 * - If token1 is quote: price = 1 token0 (base) costs X token1 (quote)
 *
 * The result is always: "quote token raw units per 1 base token (human unit)"
 *
 * @param sqrtPriceX96 - Current pool sqrt price (Q96.96 fixed-point format)
 * @param token0IsQuote - true if token0 is the quote token, false if token1 is quote
 * @param token0Decimals - Decimals of token0 (e.g., 18 for WETH, 6 for USDC)
 * @param token1Decimals - Decimals of token1
 * @returns Price in smallest quote token units per 1 base token (human unit)
 *
 * @example
 * ```typescript
 * // WETH/USDC pool (token0=WETH, token1=USDC)
 * // USDC is quote, WETH is base
 * // Price: 2000 USDC per 1 WETH
 * const price = calculatePoolPriceInQuoteToken(
 *   sqrtPriceX96,
 *   false, // token1 (USDC) is quote
 *   18,    // WETH decimals
 *   6      // USDC decimals
 * );
 * // Returns: 2000_000000n (2000 * 10^6)
 * ```
 *
 * @example
 * ```typescript
 * // USDC/WETH pool (token0=USDC, token1=WETH)
 * // USDC is quote, WETH is base
 * // Price: 2000 USDC per 1 WETH
 * const price = calculatePoolPriceInQuoteToken(
 *   sqrtPriceX96,
 *   true,  // token0 (USDC) is quote
 *   6,     // USDC decimals
 *   18     // WETH decimals
 * );
 * // Returns: 2000_000000n (2000 * 10^6)
 * ```
 */
export function calculatePoolPriceInQuoteToken(
  sqrtPriceX96: bigint,
  token0IsQuote: boolean,
  token0Decimals: number,
  token1Decimals: number
): bigint {
  if (token0IsQuote) {
    // token0 = quote, token1 = base
    // Want: token0 raw units per 1 token1 (human unit)
    // This is exactly what pricePerToken1InToken0 computes
    return pricePerToken1InToken0(sqrtPriceX96, token1Decimals);
  } else {
    // token1 = quote, token0 = base
    // Want: token1 raw units per 1 token0 (human unit)
    // This is exactly what pricePerToken0InToken1 computes
    return pricePerToken0InToken1(sqrtPriceX96, token0Decimals);
  }
}

// ============================================================================
// TOKEN VALUE CALCULATIONS
// ============================================================================

/**
 * Calculate total value of token amounts in quote currency
 *
 * Converts a pair of token amounts to a single quote currency value using
 * the current pool price. The base token amount is converted to quote using
 * the pool price, then added to the quote token amount.
 *
 * Formula:
 * - If token0 is quote: totalValue = token0Amount + (token1Amount × poolPrice / 10^token1Decimals)
 * - If token1 is quote: totalValue = token1Amount + (token0Amount × poolPrice / 10^token0Decimals)
 *
 * @param token0Amount - Amount of token0 in smallest units (wei, etc.)
 * @param token1Amount - Amount of token1 in smallest units
 * @param sqrtPriceX96 - Current pool sqrt price (Q96.96 fixed-point format)
 * @param token0IsQuote - true if token0 is the quote token, false if token1 is quote
 * @param token0Decimals - Decimals of token0
 * @param token1Decimals - Decimals of token1
 * @returns Total value in smallest quote token units
 *
 * @example
 * ```typescript
 * // WETH/USDC pool: 0.5 WETH + 1000 USDC, price = 2000 USDC/WETH
 * // token0 = WETH (18 decimals), token1 = USDC (6 decimals)
 * const value = calculateTokenValueInQuote(
 *   500000000000000000n,  // 0.5 WETH
 *   1000_000000n,         // 1000 USDC
 *   sqrtPriceX96,
 *   false,                // token1 (USDC) is quote
 *   18,
 *   6
 * );
 * // Returns: 2000_000000n (0.5 × 2000 + 1000 = 2000 USDC)
 * ```
 *
 * @example
 * ```typescript
 * // USDC/WETH pool: 1000 USDC + 0.5 WETH, price = 2000 USDC/WETH
 * // token0 = USDC (6 decimals), token1 = WETH (18 decimals)
 * const value = calculateTokenValueInQuote(
 *   1000_000000n,         // 1000 USDC
 *   500000000000000000n,  // 0.5 WETH
 *   sqrtPriceX96,
 *   true,                 // token0 (USDC) is quote
 *   6,
 *   18
 * );
 * // Returns: 2000_000000n (1000 + 0.5 × 2000 = 2000 USDC)
 * ```
 */
export function calculateTokenValueInQuote(
  token0Amount: bigint,
  token1Amount: bigint,
  sqrtPriceX96: bigint,
  token0IsQuote: boolean,
  token0Decimals: number,
  token1Decimals: number
): bigint {
  // Convert sqrtPriceX96 to bigint if it's a string (from database)
  // This handles cases where Prisma returns bigint fields as strings from JSON columns
  const sqrtPriceX96BigInt = typeof sqrtPriceX96 === 'string' ? BigInt(sqrtPriceX96) : sqrtPriceX96;

  // Get pool price in quote units per base
  const poolPrice = calculatePoolPriceInQuoteToken(
    sqrtPriceX96BigInt,
    token0IsQuote,
    token0Decimals,
    token1Decimals
  );

  if (token0IsQuote) {
    // token0 = quote, token1 = base
    // Convert token1 (base) to quote: (token1Amount × poolPrice) / 10^token1Decimals
    const token1Decimals10n = 10n ** BigInt(token1Decimals);
    const token1ValueInQuote = (token1Amount * poolPrice) / token1Decimals10n;
    return token0Amount + token1ValueInQuote;
  } else {
    // token1 = quote, token0 = base
    // Convert token0 (base) to quote: (token0Amount × poolPrice) / 10^token0Decimals
    const token0Decimals10n = 10n ** BigInt(token0Decimals);
    const token0ValueInQuote = (token0Amount * poolPrice) / token0Decimals10n;
    return token1Amount + token0ValueInQuote;
  }
}

// ============================================================================
// COST BASIS CALCULATIONS
// ============================================================================

/**
 * Calculate proportional cost basis for liquidity withdrawal
 *
 * When liquidity is removed from a position (DECREASE_POSITION event),
 * a proportional amount of the cost basis is also withdrawn.
 *
 * Formula: proportionalCostBasis = (currentCostBasis × deltaLiquidity) / currentLiquidity
 *
 * This ensures that the remaining position's cost basis accurately reflects
 * only the portion of capital that remains invested.
 *
 * @param currentCostBasis - Current total cost basis in smallest quote token units
 * @param deltaLiquidity - Amount of liquidity being removed (always positive)
 * @param currentLiquidity - Current total liquidity before removal
 * @returns Proportional cost basis being withdrawn in smallest quote token units
 * @throws Error if currentLiquidity is zero (division by zero)
 *
 * @example
 * ```typescript
 * // Position with 10,000 USDC cost basis and 2,000,000 liquidity
 * // Withdrawing 1,000,000 liquidity (50%)
 * const proportional = calculateProportionalCostBasis(
 *   10000_000000n,  // 10,000 USDC
 *   1000000n,       // 1M liquidity withdrawn
 *   2000000n        // 2M total liquidity
 * );
 * // Returns: 5000_000000n (50% of 10,000 = 5,000 USDC)
 * ```
 *
 * @example
 * ```typescript
 * // Full position close (100% withdrawal)
 * const proportional = calculateProportionalCostBasis(
 *   10000_000000n,  // 10,000 USDC
 *   2000000n,       // 2M liquidity withdrawn
 *   2000000n        // 2M total liquidity
 * );
 * // Returns: 10000_000000n (100% of 10,000 = 10,000 USDC)
 * ```
 */
export function calculateProportionalCostBasis(
  currentCostBasis: bigint,
  deltaLiquidity: bigint,
  currentLiquidity: bigint
): bigint {
  // Guard against division by zero
  if (currentLiquidity === 0n) {
    throw new Error('Current liquidity cannot be zero');
  }

  // Guard against invalid delta (should never be negative or larger than current)
  if (deltaLiquidity < 0n) {
    throw new Error('Delta liquidity cannot be negative');
  }

  if (deltaLiquidity > currentLiquidity) {
    throw new Error(
      'Delta liquidity cannot exceed current liquidity'
    );
  }

  // Special case: zero withdrawal
  if (deltaLiquidity === 0n) {
    return 0n;
  }

  // Calculate proportional cost basis
  return (currentCostBasis * deltaLiquidity) / currentLiquidity;
}

// ============================================================================
// FEE SEPARATION
// ============================================================================

/**
 * Fee Separation Result
 *
 * Breakdown of collected token amounts into fees vs principal.
 */
export interface FeeSeparationResult {
  /** Amount of token0 that is pure fees */
  feeAmount0: bigint;
  /** Amount of token1 that is pure fees */
  feeAmount1: bigint;
  /** Amount of token0 that is returned principal */
  principalAmount0: bigint;
  /** Amount of token1 that is returned principal */
  principalAmount1: bigint;
}

/**
 * Separate collected tokens into fees vs principal
 *
 * When tokens are collected from a position (COLLECT event), they may contain:
 * 1. Principal: Tokens from DECREASE_POSITION that were waiting to be collected
 * 2. Fees: Pure trading fees earned by the position
 *
 * This function separates the two using the uncollected principal pool.
 *
 * Algorithm:
 * - principalAmount = min(collectedAmount, uncollectedPrincipal)
 * - feeAmount = collectedAmount - principalAmount
 *
 * The uncollected principal pool tracks tokens from DECREASE events that
 * haven't been collected yet. When COLLECT happens, we first "return" the
 * principal, and anything beyond that is pure fees.
 *
 * @param collectedAmount0 - Total amount of token0 collected
 * @param collectedAmount1 - Total amount of token1 collected
 * @param uncollectedPrincipal0 - Available uncollected principal for token0
 * @param uncollectedPrincipal1 - Available uncollected principal for token1
 * @returns Breakdown of fees and principal for both tokens
 *
 * @example
 * ```typescript
 * // COLLECT after DECREASE: Principal only
 * const result = separateFeesFromPrincipal(
 *   1000_000000n,  // Collected 1000 USDC
 *   0n,            // Collected 0 WETH
 *   1000_000000n,  // Uncollected: 1000 USDC
 *   0n             // Uncollected: 0 WETH
 * );
 * // Returns:
 * // - feeAmount0: 0n (no fees)
 * // - principalAmount0: 1000_000000n (all principal)
 * // - feeAmount1: 0n
 * // - principalAmount1: 0n
 * ```
 *
 * @example
 * ```typescript
 * // COLLECT with fees only (no prior DECREASE)
 * const result = separateFeesFromPrincipal(
 *   100_000000n,  // Collected 100 USDC fees
 *   0n,
 *   0n,           // No uncollected principal
 *   0n
 * );
 * // Returns:
 * // - feeAmount0: 100_000000n (all fees)
 * // - principalAmount0: 0n (no principal)
 * ```
 *
 * @example
 * ```typescript
 * // COLLECT with mixed fees and principal
 * const result = separateFeesFromPrincipal(
 *   1100_000000n,  // Collected 1100 USDC
 *   0n,
 *   1000_000000n,  // Uncollected: 1000 USDC principal
 *   0n
 * );
 * // Returns:
 * // - feeAmount0: 100_000000n (fees = 1100 - 1000)
 * // - principalAmount0: 1000_000000n (principal capped at uncollected)
 * ```
 */
export function separateFeesFromPrincipal(
  collectedAmount0: bigint,
  collectedAmount1: bigint,
  uncollectedPrincipal0: bigint,
  uncollectedPrincipal1: bigint
): FeeSeparationResult {
  // Ensure non-negative inputs
  if (collectedAmount0 < 0n || collectedAmount1 < 0n) {
    throw new Error('Collected amounts cannot be negative');
  }
  if (uncollectedPrincipal0 < 0n || uncollectedPrincipal1 < 0n) {
    throw new Error('Uncollected principal cannot be negative');
  }

  // Calculate principal amounts (capped at uncollected)
  const principalAmount0 =
    collectedAmount0 < uncollectedPrincipal0
      ? collectedAmount0
      : uncollectedPrincipal0;
  const principalAmount1 =
    collectedAmount1 < uncollectedPrincipal1
      ? collectedAmount1
      : uncollectedPrincipal1;

  // Remaining amount is fees
  const feeAmount0 = collectedAmount0 - principalAmount0;
  const feeAmount1 = collectedAmount1 - principalAmount1;

  return {
    feeAmount0,
    feeAmount1,
    principalAmount0,
    principalAmount1,
  };
}

// ============================================================================
// UNCOLLECTED PRINCIPAL TRACKING
// ============================================================================

/**
 * Uncollected Principal Update Result
 *
 * Updated uncollected principal balances after an event.
 */
export interface UncollectedPrincipalResult {
  /** Uncollected principal for token0 after event */
  uncollectedPrincipal0After: bigint;
  /** Uncollected principal for token1 after event */
  uncollectedPrincipal1After: bigint;
}

/**
 * Update uncollected principal balances after a position event
 *
 * The uncollected principal pool tracks tokens from DECREASE_POSITION events
 * that are waiting to be collected. This pool is used to separate fees from
 * principal in COLLECT events.
 *
 * Update Rules:
 * - INCREASE_POSITION: No change (pass through previous values)
 * - DECREASE_POSITION: Add withdrawn amounts to pool
 * - COLLECT: Subtract collected principal from pool
 *
 * @param previousUncollected0 - Previous uncollected principal for token0
 * @param previousUncollected1 - Previous uncollected principal for token1
 * @param eventType - Type of event: 'INCREASE_POSITION' | 'DECREASE_POSITION' | 'COLLECT'
 * @param amount0 - Amount of token0 involved (meaning depends on eventType)
 * @param amount1 - Amount of token1 involved (meaning depends on eventType)
 * @param principalCollected0 - For COLLECT events: amount of principal collected (not fees)
 * @param principalCollected1 - For COLLECT events: amount of principal collected (not fees)
 * @returns Updated uncollected principal balances
 * @throws Error if attempting to collect more principal than available
 *
 * @example
 * ```typescript
 * // INCREASE_POSITION: No change
 * const result = updateUncollectedPrincipal(
 *   500_000000n,  // Previous uncollected
 *   0n,
 *   'INCREASE_POSITION',
 *   1000_000000n, // Amounts don't matter
 *   0n,
 *   0n,
 *   0n
 * );
 * // Returns: { uncollectedPrincipal0After: 500_000000n, uncollectedPrincipal1After: 0n }
 * ```
 *
 * @example
 * ```typescript
 * // DECREASE_POSITION: Add withdrawn amounts
 * const result = updateUncollectedPrincipal(
 *   0n,           // Previous uncollected
 *   0n,
 *   'DECREASE_POSITION',
 *   1000_000000n, // Withdrew 1000 USDC
 *   0n,
 *   0n,
 *   0n
 * );
 * // Returns: { uncollectedPrincipal0After: 1000_000000n, uncollectedPrincipal1After: 0n }
 * ```
 *
 * @example
 * ```typescript
 * // COLLECT: Subtract principal portion
 * const result = updateUncollectedPrincipal(
 *   1000_000000n, // Previous uncollected
 *   0n,
 *   'COLLECT',
 *   1100_000000n, // Collected 1100 total
 *   0n,
 *   1000_000000n, // Principal portion (from separateFeesFromPrincipal)
 *   0n
 * );
 * // Returns: { uncollectedPrincipal0After: 0n, uncollectedPrincipal1After: 0n }
 * ```
 */
export function updateUncollectedPrincipal(
  previousUncollected0: bigint,
  previousUncollected1: bigint,
  eventType: 'INCREASE_POSITION' | 'DECREASE_POSITION' | 'COLLECT',
  amount0: bigint,
  amount1: bigint,
  principalCollected0: bigint = 0n,
  principalCollected1: bigint = 0n
): UncollectedPrincipalResult {
  // Ensure non-negative inputs
  if (previousUncollected0 < 0n || previousUncollected1 < 0n) {
    throw new Error('Previous uncollected principal cannot be negative');
  }

  switch (eventType) {
    case 'INCREASE_POSITION':
      // No change to uncollected principal
      return {
        uncollectedPrincipal0After: previousUncollected0,
        uncollectedPrincipal1After: previousUncollected1,
      };

    case 'DECREASE_POSITION':
      // Add withdrawn amounts to uncollected principal
      if (amount0 < 0n || amount1 < 0n) {
        throw new Error('DECREASE amounts cannot be negative');
      }
      return {
        uncollectedPrincipal0After: previousUncollected0 + amount0,
        uncollectedPrincipal1After: previousUncollected1 + amount1,
      };

    case 'COLLECT':
      // Subtract collected principal from uncollected pool
      if (principalCollected0 < 0n || principalCollected1 < 0n) {
        throw new Error('Principal collected cannot be negative');
      }

      // Guard against collecting more than available
      if (principalCollected0 > previousUncollected0) {
        throw new Error(
          `Cannot collect more principal than available for token0: ${principalCollected0} > ${previousUncollected0}`
        );
      }
      if (principalCollected1 > previousUncollected1) {
        throw new Error(
          `Cannot collect more principal than available for token1: ${principalCollected1} > ${previousUncollected1}`
        );
      }

      return {
        uncollectedPrincipal0After: previousUncollected0 - principalCollected0,
        uncollectedPrincipal1After: previousUncollected1 - principalCollected1,
      };

    default:
      // TypeScript should catch this, but just in case
      throw new Error(`Unknown event type: ${eventType}`);
  }
}
