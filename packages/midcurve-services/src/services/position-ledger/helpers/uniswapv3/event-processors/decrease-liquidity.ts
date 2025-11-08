/**
 * DECREASE_LIQUIDITY Event Processor for UniswapV3 Position Ledger
 *
 * Handles processing of DECREASE_LIQUIDITY events where liquidity is removed from the position.
 */

import type { RawPositionEvent } from '../../../../../clients/etherscan/types.js';
import type { PreviousEventState } from '../state-builder.js';
import {
  calculateTokenValueInQuote,
  calculateProportionalCostBasis,
} from '../../../../../utils/uniswapv3/ledger-calculations.js';

/**
 * Result of processing a DECREASE_LIQUIDITY event.
 */
export interface DecreaseLiquidityResult {
  /** Change in liquidity (negative) */
  deltaL: bigint;
  /** Liquidity after this event */
  liquidityAfter: bigint;
  /** Change in cost basis (negative, capital withdrawn) */
  deltaCostBasis: bigint;
  /** Cost basis after this event */
  costBasisAfter: bigint;
  /** Change in PnL (realized gain or loss) */
  deltaPnl: bigint;
  /** PnL after this event */
  pnlAfter: bigint;
  /** Uncollected principal in token0 after this event (increased by withdrawn amount0) */
  uncollectedPrincipal0After: bigint;
  /** Uncollected principal in token1 after this event (increased by withdrawn amount1) */
  uncollectedPrincipal1After: bigint;
  /** Event-specific state data */
  state: {
    eventType: 'DECREASE_LIQUIDITY';
    tokenId: bigint;
    liquidity: bigint;
    amount0: bigint;
    amount1: bigint;
  };
}

/**
 * Processes a DECREASE_LIQUIDITY event.
 *
 * DECREASE_LIQUIDITY events occur when a user removes liquidity from their position.
 * This realizes PnL and adds withdrawn tokens to the uncollected principal pool.
 *
 * Financial logic:
 * - Liquidity decreases by the amount specified in the event
 * - Cost basis decreases proportionally to liquidity removed
 * - PnL is realized: (value received - proportional cost basis)
 * - Withdrawn tokens are added to uncollected principal (available for collection)
 *
 * Formula:
 * - proportionalCostBasis = (totalCostBasis × liquidityRemoved) / totalLiquidity
 * - deltaPnL = tokenValueReceived - proportionalCostBasis
 *
 * @param rawEvent - The raw DECREASE_LIQUIDITY event from Etherscan
 * @param previousState - Financial state from the previous event
 * @param sqrtPriceX96 - Historic pool price at event block (Q64.96 format)
 * @param token0IsQuote - True if token0 is the quote token
 * @param token0Decimals - Decimal places for token0
 * @param token1Decimals - Decimal places for token1
 * @returns Processed event result with updated financial state
 *
 * @example
 * ```typescript
 * const result = processDecreaseLiquidityEvent(
 *   rawEvent,
 *   {
 *     liquidity: 2000000n,
 *     costBasis: 10000000000n, // 10,000 USDC invested
 *     pnl: 0n,
 *     uncollectedPrincipal0: 0n,
 *     uncollectedPrincipal1: 0n
 *   },
 *   79228162514264337593543950336n, // sqrtPriceX96
 *   false, // token1 is quote
 *   18, // WETH decimals
 *   6   // USDC decimals
 * );
 *
 * // If removing half the liquidity:
 * console.log(result.deltaL); // 1000000n (half removed)
 * console.log(result.deltaCostBasis); // -5000000000n (half of cost basis)
 * console.log(result.deltaPnl); // 500000000n (500 USDC profit, for example)
 * console.log(result.uncollectedPrincipal0After); // 0.5 ETH (withdrawn, pending collection)
 * ```
 */
export function processDecreaseLiquidityEvent(
  rawEvent: RawPositionEvent,
  previousState: PreviousEventState,
  sqrtPriceX96: bigint,
  token0IsQuote: boolean,
  token0Decimals: number,
  token1Decimals: number
): DecreaseLiquidityResult {
  // Parse amounts and liquidity from raw event
  const amount0 = BigInt(rawEvent.amount0 ?? '0');
  const amount1 = BigInt(rawEvent.amount1 ?? '0');
  const deltaL = BigInt(rawEvent.liquidity ?? '0');
  const tokenId = BigInt(rawEvent.tokenId);

  // Update liquidity (decrease)
  const liquidityAfter = previousState.liquidity - deltaL;

  // Calculate proportional cost basis removal
  const proportionalCostBasis = calculateProportionalCostBasis(
    previousState.costBasis,
    deltaL,
    previousState.liquidity
  );

  const deltaCostBasis = -proportionalCostBasis;
  const costBasisAfter = previousState.costBasis - proportionalCostBasis;

  // Calculate token value at current (historic) price
  const tokenValue = calculateTokenValueInQuote(
    amount0,
    amount1,
    sqrtPriceX96,
    token0IsQuote,
    token0Decimals,
    token1Decimals
  );

  // Realize PnL = value received - cost basis removed
  const deltaPnl = tokenValue - proportionalCostBasis;
  const pnlAfter = previousState.pnl + deltaPnl;

  // Add withdrawn amounts to uncollected principal pool
  const uncollectedPrincipal0After = previousState.uncollectedPrincipal0 + amount0;
  const uncollectedPrincipal1After = previousState.uncollectedPrincipal1 + amount1;

  return {
    deltaL,
    liquidityAfter,
    deltaCostBasis,
    costBasisAfter,
    deltaPnl,
    pnlAfter,
    uncollectedPrincipal0After,
    uncollectedPrincipal1After,
    state: {
      eventType: 'DECREASE_LIQUIDITY',
      tokenId,
      liquidity: deltaL,
      amount0,
      amount1,
    },
  };
}
