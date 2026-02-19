import { TickMath } from "@uniswap/v3-sdk";
import { Q96, Q192 } from "./constants.js";
import type { TokenAmounts } from "./types.js";
import { mulDiv } from "../math.js";

/**
 * Uniswap V3 Liquidity Calculations
 *
 * This module provides functions for calculating token amounts from liquidity and vice versa.
 * Multiple function variants are provided with different input parameters.
 *
 * GENERAL RULE OF THUMB - Function Selection Priority:
 * ════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. ✅ PREFERRED: Use `_X96` suffix functions when possible
 *    - getTokenAmountsFromLiquidity_X96(liquidity, sqrtPriceCurrent, sqrtPriceLower, sqrtPriceUpper)
 *    - getLiquidityFromTokenAmounts_X96(sqrtPriceCurrent, sqrtPriceLower, sqrtPriceUpper, amount0, amount1)
 *    - Zero tick conversions - maximum precision preserved
 *    - Use when you already have all sqrt prices (e.g., from historical data with cached sqrtPriceX96)
 *
 * 2. ⚡ RECOMMENDED: Use base functions without suffix
 *    - getTokenAmountsFromLiquidity(liquidity, sqrtPriceCurrent, tickLower, tickUpper)
 *    - getLiquidityFromTokenAmounts(sqrtPriceCurrent, tickLower, tickUpper, amount0, amount1)
 *    - Only 2 tick→sqrt conversions (position bounds)
 *    - Use with pool.sqrtPriceX96 (always available in PoolData) + position tick bounds
 *    - BEST CHOICE for most use cases
 *
 * 3. ⚠️  LEGACY: Avoid `_withTick` suffix functions
 *    - getTokenAmountsFromLiquidity_withTick(liquidity, tickCurrent, tickLower, tickUpper)
 *    - getLiquidityFromTokenAmounts_withTick(tickCurrent, tickLower, tickUpper, amount0, amount1)
 *    - Performs 3 tick→sqrt conversions (current price + both bounds)
 *    - Only for compatibility when tick is the only available current price
 *
 * WHY THIS MATTERS:
 * ────────────────
 * - pool.sqrtPriceX96 from slot0 is the EXACT on-chain price - use it directly
 * - Each tick→sqrt conversion introduces rounding (TickMath.getSqrtRatioAtTick)
 * - Minimizing conversions = maximum precision = accurate calculations
 * - pool.currentTick is derived FROM sqrtPriceX96, never the other way around
 *
 * EXAMPLE - Typical usage pattern:
 * ────────────────────────────────
 * ```typescript
 * const pool = await getPool(chain, poolAddress); // has pool.sqrtPriceX96
 * const position = await getPosition(positionId);  // has tickLower, tickUpper
 *
 * // ✅ BEST: Use base function with sqrtPriceX96 + tick bounds
 * const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
 *   liquidity,
 *   BigInt(pool.sqrtPriceX96),  // exact price from slot0
 *   position.tickLower,          // tick bounds
 *   position.tickUpper
 * );
 * ```
 */

/**
 * Calculate token amounts from liquidity given current sqrt price and tick bounds.
 *
 * RECOMMENDED FUNCTION - Hybrid approach: accepts sqrtPriceCurrent (from pool.sqrtPriceX96)
 * and tick bounds (from position), minimizing conversions to only position bounds.
 *
 * @param liquidity The liquidity amount
 * @param sqrtPriceCurrentX96 Current sqrt price from pool.sqrtPriceX96 (Q96.96 format)
 * @param tickLower Lower bound tick from position
 * @param tickUpper Upper bound tick from position
 * @param roundUp Whether to round up (default: false = floor)
 * @returns Token amounts for token0 and token1
 */
export function getTokenAmountsFromLiquidity(
    liquidity: bigint,
    sqrtPriceCurrentX96: bigint,
    tickLower: number,
    tickUpper: number,
    roundUp: boolean = false
): TokenAmounts {
    // Ensure ticks are actual numbers (defensive programming for JSON deserialization)
    const lowerTick = typeof tickLower === 'number' ? tickLower : Number(tickLower);
    const upperTick = typeof tickUpper === 'number' ? tickUpper : Number(tickUpper);

    const sqrtPriceLowerX96 = TickMath.getSqrtRatioAtTick(lowerTick).toString();
    const sqrtPriceUpperX96 = TickMath.getSqrtRatioAtTick(upperTick).toString();

    const result = getTokenAmountsFromLiquidity_X96(
        liquidity,
        sqrtPriceCurrentX96,
        BigInt(sqrtPriceLowerX96),
        BigInt(sqrtPriceUpperX96),
        roundUp
    );

    return result;
}

/**
 * Calculate liquidity from token amounts given current sqrt price and tick bounds.
 *
 * RECOMMENDED FUNCTION - Hybrid approach: accepts sqrtPriceCurrent (from pool.sqrtPriceX96)
 * and tick bounds (from position), minimizing conversions to only position bounds.
 *
 * @param sqrtPriceCurrentX96 Current sqrt price from pool.sqrtPriceX96 (Q96.96 format)
 * @param tickLower Lower bound tick from position
 * @param tickUpper Upper bound tick from position
 * @param token0Amount Amount of token0 available
 * @param token1Amount Amount of token1 available
 * @returns Maximum liquidity that can be provided
 */
export function getLiquidityFromTokenAmounts(
    sqrtPriceCurrentX96: bigint,
    tickLower: number,
    tickUpper: number,
    token0Amount: bigint,
    token1Amount: bigint
): bigint {
    const sqrtPriceLowerX96 = TickMath.getSqrtRatioAtTick(tickLower).toString();
    const sqrtPriceUpperX96 = TickMath.getSqrtRatioAtTick(tickUpper).toString();
    return getLiquidityFromTokenAmounts_X96(
        sqrtPriceCurrentX96,
        BigInt(sqrtPriceLowerX96),
        BigInt(sqrtPriceUpperX96),
        token0Amount,
        token1Amount
    );
}

/**
 * Calculate token amounts from liquidity for a given sqrt price range.
 *
 * ⭐ PREFERRED FUNCTION - Zero tick conversions, maximum precision.
 * Use when you already have all sqrt prices (e.g., from historical pool state cache).
 *
 * @param liquidity The liquidity amount
 * @param sqrtPriceCurrentX96 Current sqrt price (Q96.96 format)
 * @param sqrtPriceLowerX96 Lower bound sqrt price (Q96.96 format)
 * @param sqrtPriceUpperX96 Upper bound sqrt price (Q96.96 format)
 * @param roundUp Whether to round up (default: false = floor)
 * @returns Token amounts for token0 and token1
 */
export function getTokenAmountsFromLiquidity_X96(
    liquidity: bigint,
    sqrtPriceCurrentX96: bigint,
    sqrtPriceLowerX96: bigint,
    sqrtPriceUpperX96: bigint,
    roundUp: boolean = false
): TokenAmounts {
    if (liquidity === 0n) {
        return { token0Amount: 0n, token1Amount: 0n };
    }

    if (sqrtPriceCurrentX96 <= sqrtPriceLowerX96) {
        // Price below range – all liquidity in token0
        return {
            token0Amount: getAmount0FromLiquidity(
                sqrtPriceLowerX96,
                sqrtPriceUpperX96,
                liquidity,
                roundUp
            ),
            token1Amount: 0n,
        };
    }

    if (sqrtPriceCurrentX96 >= sqrtPriceUpperX96) {
        // Price above range – all liquidity in token1
        return {
            token0Amount: 0n,
            token1Amount: getAmount1FromLiquidity(
                sqrtPriceLowerX96,
                sqrtPriceUpperX96,
                liquidity,
                roundUp
            ),
        };
    }

    // Price within range – mixed liquidity
    return {
        token0Amount: getAmount0FromLiquidity(
            sqrtPriceCurrentX96,
            sqrtPriceUpperX96,
            liquidity,
            roundUp
        ),
        token1Amount: getAmount1FromLiquidity(
            sqrtPriceLowerX96,
            sqrtPriceCurrentX96,
            liquidity,
            roundUp
        ),
    };
}

/**
 * Calculate liquidity from token0/token1 amounts for a given sqrt price range.
 *
 * ⭐ PREFERRED FUNCTION - Zero tick conversions, maximum precision.
 * Use when you already have all sqrt prices (e.g., from historical pool state cache).
 *
 * @param sqrtPriceCurrentX96 Current sqrt price (Q96.96 format)
 * @param sqrtPriceLowerX96 Lower bound sqrt price (Q96.96 format)
 * @param sqrtPriceUpperX96 Upper bound sqrt price (Q96.96 format)
 * @param token0Amount Amount of token0 available
 * @param token1Amount Amount of token1 available
 * @returns Maximum liquidity that can be provided
 */
export function getLiquidityFromTokenAmounts_X96(
    sqrtPriceCurrentX96: bigint,
    sqrtPriceLowerX96: bigint,
    sqrtPriceUpperX96: bigint,
    token0Amount: bigint,
    token1Amount: bigint
): bigint {
    if (sqrtPriceCurrentX96 <= sqrtPriceLowerX96) {
        // Price below range – only token0 provides liquidity
        return getLiquidityFromAmount0(
            sqrtPriceLowerX96,
            sqrtPriceUpperX96,
            token0Amount,
            /* roundUp */ false
        );
    }

    if (sqrtPriceCurrentX96 >= sqrtPriceUpperX96) {
        // Price above range – only token1 provides liquidity
        return getLiquidityFromAmount1(
            sqrtPriceLowerX96,
            sqrtPriceUpperX96,
            token1Amount,
            /* roundUp */ false
        );
    }

    // Price within range – both tokens contribute, take the minimum
    const liquidity0 = getLiquidityFromAmount0(
        sqrtPriceCurrentX96,
        sqrtPriceUpperX96,
        token0Amount,
        false
    );
    const liquidity1 = getLiquidityFromAmount1(
        sqrtPriceLowerX96,
        sqrtPriceCurrentX96,
        token1Amount,
        false
    );

    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
}

/**
 * Calculate token amounts from liquidity using tick-based current price.
 *
 * ⚠️  LEGACY FUNCTION - Avoid if possible. Performs 3 tick→sqrt conversions.
 * Only use when current price is only available as tick (rare - pool.sqrtPriceX96 is always available).
 * Consider using getTokenAmountsFromLiquidity() with pool.sqrtPriceX96 instead.
 *
 * @param liquidity The liquidity amount
 * @param tickCurrent Current price as tick (less precise than sqrtPriceX96)
 * @param tickLower Lower bound tick
 * @param tickUpper Upper bound tick
 * @param roundUp Whether to round up (default: false = floor)
 * @returns Token amounts for token0 and token1
 */
export function getTokenAmountsFromLiquidity_withTick(
    liquidity: bigint,
    tickCurrent: number,
    tickLower: number,
    tickUpper: number,
    roundUp: boolean = false
): TokenAmounts {
    const sqrtPriceCurrentX96 = TickMath.getSqrtRatioAtTick(tickCurrent);
    return getTokenAmountsFromLiquidity(
        liquidity,
        BigInt(sqrtPriceCurrentX96.toString()),
        tickLower,
        tickUpper,
        roundUp
    );
}

/**
 * Calculate liquidity from token amounts using tick-based current price.
 *
 * ⚠️  LEGACY FUNCTION - Avoid if possible. Performs 3 tick→sqrt conversions.
 * Only use when current price is only available as tick (rare - pool.sqrtPriceX96 is always available).
 * Consider using getLiquidityFromTokenAmounts() with pool.sqrtPriceX96 instead.
 *
 * @param tickCurrent Current price as tick (less precise than sqrtPriceX96)
 * @param tickLower Lower bound tick
 * @param tickUpper Upper bound tick
 * @param token0Amount Amount of token0 available
 * @param token1Amount Amount of token1 available
 * @returns Maximum liquidity that can be provided
 */
export function getLiquidityFromTokenAmounts_withTick(
    tickCurrent: number,
    tickLower: number,
    tickUpper: number,
    token0Amount: bigint,
    token1Amount: bigint
): bigint {
    const sqrtPriceCurrentX96 = BigInt(
        TickMath.getSqrtRatioAtTick(tickCurrent).toString()
    );
    return getLiquidityFromTokenAmounts(
        sqrtPriceCurrentX96,
        tickLower,
        tickUpper,
        token0Amount,
        token1Amount
    );
}

// Helper functions for liquidity math

export function getAmount0FromLiquidity(
    sqrtPriceLower: bigint,
    sqrtPriceUpper: bigint,
    liquidity: bigint,
    roundUp: boolean = false
): bigint {
    // Ensure all values are bigint (defensive programming for mixed types)
    const priceLower = typeof sqrtPriceLower === 'bigint' ? sqrtPriceLower : BigInt(sqrtPriceLower);
    const priceUpper = typeof sqrtPriceUpper === 'bigint' ? sqrtPriceUpper : BigInt(sqrtPriceUpper);
    const liq = typeof liquidity === 'bigint' ? liquidity : BigInt(liquidity);

    if (priceUpper <= priceLower || liq === 0n) return 0n;
    const numerator1 = liq * (priceUpper - priceLower); // L * (Δ√P)
    const denominator = priceUpper * priceLower;

    if (roundUp) {
        // Use ceiling division
        const product = numerator1 * Q96;
        return product % denominator === 0n
            ? product / denominator
            : product / denominator + 1n;
    } else {
        return mulDiv(numerator1, Q96, denominator);
    }
}

export function getAmount1FromLiquidity(
    sqrtPriceLower: bigint,
    sqrtPriceUpper: bigint,
    liquidity: bigint,
    roundUp: boolean = false
): bigint {
    // Ensure all values are bigint (defensive programming for mixed types)
    const priceLower = typeof sqrtPriceLower === 'bigint' ? sqrtPriceLower : BigInt(sqrtPriceLower);
    const priceUpper = typeof sqrtPriceUpper === 'bigint' ? sqrtPriceUpper : BigInt(sqrtPriceUpper);
    const liq = typeof liquidity === 'bigint' ? liquidity : BigInt(liquidity);

    if (priceUpper <= priceLower || liq === 0n) return 0n;
    const delta = priceUpper - priceLower;

    if (roundUp) {
        // Use ceiling division
        const product = liq * delta;
        return product % Q96 === 0n ? product / Q96 : product / Q96 + 1n;
    } else {
        return mulDiv(liq, delta, Q96);
    }
}

export function getLiquidityFromAmount0(
    sqrtPriceLower: bigint,
    sqrtPriceUpper: bigint,
    amount0: bigint,
    roundUp: boolean = false
): bigint {
    if (sqrtPriceUpper <= sqrtPriceLower || amount0 <= 0n) return 0n;
    const delta = sqrtPriceUpper - sqrtPriceLower;
    const numerator = amount0 * (sqrtPriceLower * sqrtPriceUpper);
    const denominator = Q96 * delta;

    if (roundUp) {
        // Ceiling division: (a + b - 1) / b
        return (numerator + denominator - 1n) / denominator;
    } else {
        // Floor division (default)
        return numerator / denominator;
    }
}

export function getLiquidityFromAmount1(
    sqrtPriceLower: bigint,
    sqrtPriceUpper: bigint,
    amount1: bigint,
    roundUp: boolean = false
): bigint {
    if (sqrtPriceUpper <= sqrtPriceLower || amount1 <= 0n) return 0n;
    const delta = sqrtPriceUpper - sqrtPriceLower;
    const numerator = amount1 * Q96;
    const denominator = delta;

    if (roundUp) {
        // Ceiling division: (a + b - 1) / b
        return (numerator + denominator - 1n) / denominator;
    } else {
        // Floor division (default)
        return numerator / denominator;
    }
}

export const pow10 = (n: number) => 10n ** BigInt(n);

/**
 * Calculate liquidity from total investment amounts using exact sqrt prices
 * Converts both base and quote amounts to total quote value, then calculates maximum liquidity
 * @param baseAmount Amount of base token to invest (in base token decimals)
 * @param baseDecimals Number of decimals for base token
 * @param quoteAmount Amount of quote token to invest (in quote token decimals)
 * @param quoteDecimals Number of decimals for quote token
 * @param isQuoteToken0 Whether quote token is token0 (affects price calculation)
 * @param sqrtPriceLowerX96 Lower bound sqrt price (Q96.96 format)
 * @param sqrtPriceUpperX96 Upper bound sqrt price (Q96.96 format)
 * @param sqrtPriceCurrentX96 Current sqrt price from pool slot0 (Q96.96 format)
 * @returns Maximum liquidity that can be provided with total investment
 */
export function getLiquidityFromInvestmentAmounts(
    baseAmount: bigint, // amount of base token (the non-quote token)
    _baseDecimals: number,
    quoteAmount: bigint, // amount of quote token (your accounting currency)
    _quoteDecimals: number,
    isQuoteToken0: boolean, // true: quote=token0, false: quote=token1
    sqrtPriceLowerX96: bigint,
    sqrtPriceUpperX96: bigint,
    sqrtPriceCurrentX96: bigint // <- slot0.sqrtPriceX96
): bigint {
    if (baseAmount <= 0n && quoteAmount <= 0n) return 0n;

    // Ensure ordering
    const A =
        sqrtPriceUpperX96 > sqrtPriceLowerX96
            ? sqrtPriceUpperX96
            : sqrtPriceLowerX96; // upper
    const B =
        sqrtPriceUpperX96 > sqrtPriceLowerX96
            ? sqrtPriceLowerX96
            : sqrtPriceUpperX96; // lower
    const S = sqrtPriceCurrentX96;

    // Current location vs. range
    if (S <= B) {
        // BELOW range -> all liquidity needs token0
        // Convert total budget to token0 if needed, then use amount0->L
        const totalBudgetQuote = totalBudgetInQuote(
            baseAmount,
            quoteAmount,
            isQuoteToken0,
            S
        );
        const amount0 = isQuoteToken0
            ? totalBudgetQuote // already token0 units
            : quoteToToken0(totalBudgetQuote, S);
        return getLiquidityFromAmount0(B, A, amount0);
    }

    if (S >= A) {
        // ABOVE range -> all liquidity needs token1
        // Convert total budget to token1 if needed, then use amount1->L
        const totalBudgetQuote = totalBudgetInQuote(
            baseAmount,
            quoteAmount,
            isQuoteToken0,
            S
        );
        const amount1 = isQuoteToken0
            ? token0ToQuoteToken1(totalBudgetQuote, S) // convert token0->token1
            : totalBudgetQuote; // already token1 units
        return getLiquidityFromAmount1(B, A, amount1);
    }

    // IN RANGE: compute L = (Budget * Q96) / (K_Q96 * 10^quoteDecimals)
    const budgetQuote = totalBudgetInQuote(
        baseAmount,
        quoteAmount,
        isQuoteToken0,
        S
    );

    const K_Q96 = isQuoteToken0
        ? K_Q96_inToken0(B, A, S) // quote is token0
        : K_Q96_inToken1(B, A, S); // quote is token1
    if (K_Q96 <= 0n) return 0n; // guard (degenerate edges)

    return (budgetQuote * Q96) / K_Q96;
}

/**
 * Calculate liquidity from total investment amounts using tick boundaries (compatibility wrapper)
 * Less accurate than using exact sqrt prices - prefer getLiquidityFromInvestmentAmounts when possible
 * @param baseAmount Amount of base token to invest (in base token decimals)
 * @param baseDecimals Number of decimals for base token
 * @param quoteAmount Amount of quote token to invest (in quote token decimals)
 * @param quoteDecimals Number of decimals for quote token
 * @param isQuoteToken0 Whether quote token is token0 (affects price calculation)
 * @param tickUpper Upper bound tick
 * @param tickLower Lower bound tick
 * @param sqrtPriceCurrentX96 Current sqrt price from pool slot0 (Q96.96 format)
 * @returns Maximum liquidity that can be provided with total investment
 */
export function getLiquidityFromInvestmentAmounts_withTick(
    baseAmount: bigint,
    baseDecimals: number,
    quoteAmount: bigint,
    quoteDecimals: number,
    isQuoteToken0: boolean,
    tickUpper: number,
    tickLower: number,
    sqrtPriceCurrentX96: bigint
): bigint {
    const sqrtPriceLowerX96 = BigInt(
        TickMath.getSqrtRatioAtTick(tickLower).toString()
    );
    const sqrtPriceUpperX96 = BigInt(
        TickMath.getSqrtRatioAtTick(tickUpper).toString()
    );
    return getLiquidityFromInvestmentAmounts(
        baseAmount,
        baseDecimals,
        quoteAmount,
        quoteDecimals,
        isQuoteToken0,
        sqrtPriceLowerX96,
        sqrtPriceUpperX96,
        sqrtPriceCurrentX96
    );
}

// -----------------------------
// Helpers
// -----------------------------

/**
 * Convert both pockets into QUOTE token units and sum them.
 * Uses correct Q192 price depending on whether quote is token0 or token1.
 */
function totalBudgetInQuote(
    baseAmount: bigint,
    quoteAmount: bigint,
    isQuoteToken0: boolean,
    S: bigint
): bigint {
    const baseAsQuote = isQuoteToken0
        ? // quote=token0, base=token1 -> price (quote/base) = Q192 / S^2
          (baseAmount * Q192) / (S * S)
        : // quote=token1, base=token0 -> price (quote/base) = S^2 / Q192
          (baseAmount * S * S) / Q192;
    return quoteAmount + baseAsQuote;
}

/** Convert a QUOTE budget (token1) into token0 amount, respecting decimals. */
function quoteToToken0(amountQuoteToken1: bigint, S: bigint): bigint {
    // token0/token1 price = Q192 / S^2
    return (amountQuoteToken1 * Q192) / (S * S);
}

/** Convert a QUOTE budget (token0) into token1 amount, respecting decimals. */
function token0ToQuoteToken1(amountQuoteToken0: bigint, S: bigint): bigint {
    // token1/token0 price = S^2 / Q192
    return (amountQuoteToken0 * S * S) / Q192;
}

/**
 * K (quote value per unit L) in token1 units, scaled by Q96.
 * K_Q96 = (S - B) + floor( S * (A - S) / A )
 */
function K_Q96_inToken1(B: bigint, A: bigint, S: bigint): bigint {
    if (S <= B) return 0n;
    if (S >= A) return 0n;
    const term1 = S - B; // already in X96 units
    const term2 = (S * (A - S)) / A; // floor(S * (A - S) / A), still X96
    return term1 + term2; // X96
}

/**
 * K (quote value per unit L) in token0 units, scaled by Q96.
 * K0_perL = Q96*(A - S)/(A*S) + Q96*(S - B)/S^2
 * => K_Q96 = Q192*(A - S)/(A*S) + Q192*(S - B)/S^2  (so that final division uses ... *Q96 / K_Q96)
 */
function K_Q96_inToken0(B: bigint, A: bigint, S: bigint): bigint {
    if (S <= B) return 0n;
    if (S >= A) return 0n;
    const termA = (Q192 * (A - S)) / (A * S); // ~ Q96*(A - S)/(A*S) * Q96
    const termB = (Q192 * (S - B)) / (S * S); // ~ Q96*(S - B)/S^2 * Q96
    return termA + termB; // X96
}

/**
 * Calculate position value at current price
 *
 * Calculates the total value of a Uniswap V3 position in quote token units.
 * Converts all token amounts to quote token value using the pool's sqrtPriceX96.
 *
 * @param liquidity The position liquidity
 * @param sqrtPriceCurrentX96 Current sqrt price from pool (Q96.96 format)
 * @param tickLower Lower bound tick
 * @param tickUpper Upper bound tick
 * @param baseIsToken0 Whether base token is token0
 * @returns Position value in quote token units
 */
export function calculatePositionValue(
    liquidity: bigint,
    sqrtPriceCurrentX96: bigint,
    tickLower: number,
    tickUpper: number,
    baseIsToken0: boolean
): bigint {
    // Ensure all bigint parameters are actually bigint (defensive programming for JSON deserialization)
    const liquidityBigint = typeof liquidity === 'bigint' ? liquidity : BigInt(liquidity);
    const sqrtPriceBigint = typeof sqrtPriceCurrentX96 === 'bigint' ? sqrtPriceCurrentX96 : BigInt(sqrtPriceCurrentX96);

    if (liquidityBigint === 0n) return 0n;
    if (sqrtPriceBigint === 0n) return 0n;

    // Get token amounts from liquidity
    const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidityBigint,
        sqrtPriceBigint,
        tickLower,
        tickUpper
    );

    // Calculate price and value
    // We need to be very careful about units and scaling

    // For token amounts: getTokenAmountsFromLiquidity returns amounts in smallest units
    // e.g., token0Amount might be 12.84 * 10^18 wei for WETH

    // For price calculation, we convert token amounts directly to quote value
    // using the sqrt price ratio from the pool

    // Ensure token amounts are bigint (defensive programming)
    const token0Bigint = typeof token0Amount === 'bigint' ? token0Amount : BigInt(token0Amount);
    const token1Bigint = typeof token1Amount === 'bigint' ? token1Amount : BigInt(token1Amount);

    let value: bigint;

    if (baseIsToken0) {
        // token0 = base, token1 = quote
        // Need to convert token0 (base) to quote using price from sqrtPriceX96
        // price (token1/token0) = sqrtPriceX96^2 / 2^192
        const sqrtP2 = sqrtPriceBigint * sqrtPriceBigint;
        // Convert token0 amount to token1 (quote) equivalent
        // token1Value = token0Amount * (sqrtP2 / Q192)
        const token0AsQuote = (token0Bigint * sqrtP2) / Q192;
        value = token0AsQuote + token1Bigint;
    } else {
        // token0 = quote, token1 = base
        // Need to convert token1 (base) to quote using price from sqrtPriceX96
        // price (token0/token1) = 2^192 / sqrtPriceX96^2
        const sqrtP2 = sqrtPriceBigint * sqrtPriceBigint;
        // Convert token1 amount to token0 (quote) equivalent
        // token0Value = token1Amount * (Q192 / sqrtP2)
        const token1AsQuote = (token1Bigint * Q192) / sqrtP2;
        value = token0Bigint + token1AsQuote;
    }

    return value;
}
