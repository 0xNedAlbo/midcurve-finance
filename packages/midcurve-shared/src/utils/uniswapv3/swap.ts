import { Q192 } from './constants.js';
import type { SwapDirection } from '../../types/automation/close-order-config.types.js';

/**
 * Estimates the output amount for an exact-input swap through a UniswapV3 pool
 * using the pool's current spot price and fee tier.
 *
 * This is an approximation that assumes zero price impact (infinite liquidity at spot).
 * Suitable for path ranking and estimation — NOT for exact on-chain quoting.
 * Actual slippage protection should use an external fair-value oracle (e.g. CoinGecko).
 *
 * Algorithm:
 *   1. Deduct fee: effectiveIn = amountIn * (1_000_000 - fee) / 1_000_000
 *   2. Apply spot price conversion:
 *      - TOKEN0→TOKEN1: out = effectiveIn * S² / Q192
 *      - TOKEN1→TOKEN0: out = effectiveIn * Q192 / S²
 *
 * @param amountIn Raw input amount (in token's smallest unit)
 * @param sqrtPriceX96 Current pool sqrtPriceX96 (Q96.96 fixed-point)
 * @param fee UniswapV3 fee tier (100, 500, 3000, or 10000)
 * @param direction Swap direction relative to pool token ordering
 * @returns Estimated raw output amount (floored)
 */
export function computeExpectedSwapOutput(
  amountIn: bigint,
  sqrtPriceX96: bigint,
  fee: number,
  direction: SwapDirection
): bigint {
  if (amountIn <= 0n) return 0n;
  if (sqrtPriceX96 <= 0n) return 0n;

  // 1. Deduct fee (fee is in millionths: 3000 = 0.3%)
  const effectiveIn = (amountIn * (1_000_000n - BigInt(fee))) / 1_000_000n;

  // 2. Convert using spot price
  if (direction === 'TOKEN0_TO_1') {
    // token0 → token1: amountOut = effectiveIn * S² / Q192
    return (effectiveIn * sqrtPriceX96 * sqrtPriceX96) / Q192;
  } else {
    // token1 → token0: amountOut = effectiveIn * Q192 / S²
    return (effectiveIn * Q192) / (sqrtPriceX96 * sqrtPriceX96);
  }
}

/**
 * Estimates the output amount for a multi-hop swap by chaining single-hop estimates.
 * Each hop's output becomes the next hop's input.
 *
 * @param amountIn Raw input amount for the first hop
 * @param hops Array of hop parameters in execution order
 * @returns Estimated final output amount (floored), or 0n if any hop produces zero
 */
export function computeMultiHopSwapOutput(
  amountIn: bigint,
  hops: ReadonlyArray<{
    sqrtPriceX96: bigint;
    fee: number;
    direction: SwapDirection;
  }>
): bigint {
  let currentAmount = amountIn;

  for (const hop of hops) {
    currentAmount = computeExpectedSwapOutput(
      currentAmount,
      hop.sqrtPriceX96,
      hop.fee,
      hop.direction
    );
    if (currentAmount === 0n) return 0n;
  }

  return currentAmount;
}
