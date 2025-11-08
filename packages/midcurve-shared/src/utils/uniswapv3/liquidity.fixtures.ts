import { TickMath } from '@uniswap/v3-sdk';

// Core constants
export const Q96 = 79228162514264337593543950336n; // 2^96
export const Q192 = Q96 * Q96;

// Convenience
const scaleQ96 = (num: number, den = 1000) => (Q96 * BigInt(num)) / BigInt(den);

// Shared sqrt range (perfectly "round" relative to Q96)
export const SQRT_LOWER = scaleQ96(1100); // 1.1 * Q96
export const SQRT_UPPER = scaleQ96(1300); // 1.3 * Q96

// Current prices for 3 scenarios
export const SQRT_BELOW = scaleQ96(1000); // 1.0 * Q96 (S <= B)
export const SQRT_IN = scaleQ96(1200); // 1.2 * Q96 (B < S < A)
export const SQRT_ABOVE = scaleQ96(1400); // 1.4 * Q96 (S >= A)

// Liquidity used in many cases
export const L = 1_000_000_000_000_000_000n; // 1e18

// ---------- getTokenAmountsFromLiquidity_X96 (floor) ----------
export const tokenAmounts_X96_floor = {
  BELOW: {
    sqrtPriceCurrentX96: SQRT_BELOW,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    liquidity: L,
    roundUp: false,
    expected: {
      token0Amount: 139_860_139_860_139_860n,
      token1Amount: 0n,
    },
  },
  IN_RANGE: {
    sqrtPriceCurrentX96: SQRT_IN,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    liquidity: L,
    roundUp: false,
    expected: {
      token0Amount: 64_102_564_102_564_102n,
      token1Amount: 100_000_000_000_000_000n,
    },
  },
  ABOVE: {
    sqrtPriceCurrentX96: SQRT_ABOVE,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    liquidity: L,
    roundUp: false,
    expected: {
      token0Amount: 0n,
      token1Amount: 199_999_999_999_999_999n,
    },
  },
} as const;

// ---------- getTokenAmountsFromLiquidity_X96 (roundUp: true) ----------
export const tokenAmounts_X96_ceil = {
  BELOW: {
    sqrtPriceCurrentX96: SQRT_BELOW,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    liquidity: L,
    roundUp: true,
    expected: {
      token0Amount: 139_860_139_860_139_861n,
      token1Amount: 0n,
    },
  },
  IN_RANGE: {
    sqrtPriceCurrentX96: SQRT_IN,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    liquidity: L,
    roundUp: true,
    expected: {
      token0Amount: 64_102_564_102_564_103n,
      token1Amount: 100_000_000_000_000_001n,
    },
  },
  ABOVE: {
    sqrtPriceCurrentX96: SQRT_ABOVE,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    liquidity: L,
    roundUp: true,
    expected: {
      token0Amount: 0n,
      token1Amount: 200_000_000_000_000_000n,
    },
  },
} as const;

// ---------- getLiquidityFromAmount0 / getLiquidityFromAmount1 (floor) ----------
// Using the amounts from the FLOOR case above; floor makes these slightly <= L.
export const liquidityFromAmounts_floor = {
  BELOW_from0: {
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    amount0: tokenAmounts_X96_floor.BELOW.expected.token0Amount,
    roundUp: false,
    expectedLiquidity: 999_999_999_999_999_998n,
  },
  ABOVE_from1: {
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    amount1: tokenAmounts_X96_floor.ABOVE.expected.token1Amount,
    roundUp: false,
    expectedLiquidity: 999_999_999_999_999_995n,
  },
  IN_from0: {
    sqrtPriceLowerX96: SQRT_IN,
    sqrtPriceUpperX96: SQRT_UPPER,
    amount0: tokenAmounts_X96_floor.IN_RANGE.expected.token0Amount,
    roundUp: false,
    expectedLiquidity: 999_999_999_999_999_991n,
  },
  IN_from1: {
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_IN,
    amount1: tokenAmounts_X96_floor.IN_RANGE.expected.token1Amount,
    roundUp: false,
    expectedLiquidity: 999_999_999_999_999_999n,
  },
} as const;

// ---------- getLiquidityFromAmount0 / 1 (roundUp: true) ----------
// With ceiling the results are >= L by a tiny epsilon.
export const liquidityFromAmounts_ceil = {
  BELOW_from0: {
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    amount0: tokenAmounts_X96_ceil.BELOW.expected.token0Amount,
    roundUp: true,
    expectedLiquidity: 1_000_000_000_000_000_007n,
  },
  ABOVE_from1: {
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    amount1: tokenAmounts_X96_ceil.ABOVE.expected.token1Amount,
    roundUp: true,
    expectedLiquidity: 1_000_000_000_000_000_001n,
  },
  IN_from0: {
    sqrtPriceLowerX96: SQRT_IN,
    sqrtPriceUpperX96: SQRT_UPPER,
    amount0: tokenAmounts_X96_ceil.IN_RANGE.expected.token0Amount,
    roundUp: true,
    expectedLiquidity: 1_000_000_000_000_000_007n,
  },
  IN_from1: {
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_IN,
    amount1: tokenAmounts_X96_ceil.IN_RANGE.expected.token1Amount,
    roundUp: true,
    expectedLiquidity: 1_000_000_000_000_000_010n,
  },
} as const;

// ---------- getLiquidityFromTokenAmounts_X96 (floor) ----------
export const liquidityFromTokenAmounts_X96 = {
  BELOW: {
    sqrtPriceCurrentX96: SQRT_BELOW,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    token0Amount: tokenAmounts_X96_floor.BELOW.expected.token0Amount,
    token1Amount: tokenAmounts_X96_floor.BELOW.expected.token1Amount,
    expectedLiquidity: 999_999_999_999_999_998n,
  },
  IN_RANGE: {
    sqrtPriceCurrentX96: SQRT_IN,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    token0Amount: tokenAmounts_X96_floor.IN_RANGE.expected.token0Amount,
    token1Amount: tokenAmounts_X96_floor.IN_RANGE.expected.token1Amount,
    expectedLiquidity: 999_999_999_999_999_991n, // min(L0, L1)
  },
  ABOVE: {
    sqrtPriceCurrentX96: SQRT_ABOVE,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    token0Amount: tokenAmounts_X96_floor.ABOVE.expected.token0Amount,
    token1Amount: tokenAmounts_X96_floor.ABOVE.expected.token1Amount,
    expectedLiquidity: 999_999_999_999_999_995n,
  },
} as const;

// ---------- Investment-based liquidity (in-range) ----------
// Choose some pocket sizes; decimals are irrelevant in these helpers (raw units).
export const INVEST_baseAmount = 500_000_000_000_000_000n; // 0.5 (raw)
export const INVEST_quoteAmount = 200_000_000_000_000_000n; // 0.2 (raw)

export const investmentFixtures_inRange = {
  // quote = token1
  QUOTE_is_token1: {
    isQuoteToken0: false,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    sqrtPriceCurrentX96: SQRT_IN,
    baseAmount: INVEST_baseAmount,
    quoteAmount: INVEST_quoteAmount,
    expectedLiquidity: 4_783_999_999_999_999_994n,
  },
  // quote = token0
  QUOTE_is_token0: {
    isQuoteToken0: true,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    sqrtPriceCurrentX96: SQRT_IN,
    baseAmount: INVEST_baseAmount,
    quoteAmount: INVEST_quoteAmount,
    expectedLiquidity: 4_097_599_999_999_999_998n,
  },
} as const;

// ---------- Investment-based liquidity (below/above range) ----------
export const investmentFixtures_edge = {
  BELOW_S: {
    sqrtPriceCurrentX96: SQRT_BELOW,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    baseAmount: INVEST_baseAmount,
    quoteAmount: INVEST_quoteAmount,
    expectedLiquidity_whenQuoteToken1: 5_004_999_999_999_999_999n,
    expectedLiquidity_whenQuoteToken0: 5_004_999_999_999_999_999n,
  },
  ABOVE_S: {
    sqrtPriceCurrentX96: SQRT_ABOVE,
    sqrtPriceLowerX96: SQRT_LOWER,
    sqrtPriceUpperX96: SQRT_UPPER,
    baseAmount: INVEST_baseAmount,
    quoteAmount: INVEST_quoteAmount,
    expectedLiquidity_whenQuoteToken1: 5_899_999_999_999_999_995n,
    expectedLiquidity_whenQuoteToken0: 4_459_999_999_999_999_990n,
  },
} as const;

// ---------- Real-world pool sanity fixture (Arbitrum WETH/USDC) ----------
// Provided values: sqrtPriceX96 and tick.
// Pick a small window around the tick for wrappers that use ticks.
// NOTE: Let the test compute sqrt bounds via TickMath to compare with _X96 variants.
export const ARB_WETH_USDC_REAL = {
  sqrtPriceCurrentX96: 4_880_027_310_900_678_652_549_898n, // from user
  tickCurrent: -193_909,
  tickLower: -194_000,
  tickUpper: -193_800,
  sampleLiquidity: 1_000_000_000_000_000_000n,
  // Expectations:
  // - Using getTokenAmountsFromLiquidity_withTick vs getTokenAmountsFromLiquidity_X96
  //   (with sqrt bounds from TickMath) must match exactly for floor rounding.
  assert: (t = TickMath) => {
    const lower = BigInt(t.getSqrtRatioAtTick(-194000).toString());
    const upper = BigInt(t.getSqrtRatioAtTick(-193800).toString());
    return { sqrtLowerX96: lower, sqrtUpperX96: upper };
  },
} as const;
