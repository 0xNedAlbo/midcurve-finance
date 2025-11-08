/**
 * INCREASE_LIQUIDITY Event Processor for UniswapV3 Position Ledger
 *
 * Handles processing of INCREASE_LIQUIDITY events where liquidity is added to the position.
 */

import type { RawPositionEvent } from '../../../../../clients/etherscan/types.js';
import type { PreviousEventState } from '../state-builder.js';
import { calculateTokenValueInQuote } from '../../../../../utils/uniswapv3/ledger-calculations.js';

/**
 * Result of processing an INCREASE_LIQUIDITY event.
 */
export interface IncreaseLiquidityResult {
  /** Change in liquidity (positive) */
  deltaL: bigint;
  /** Liquidity after this event */
  liquidityAfter: bigint;
  /** Change in cost basis (positive, capital added) */
  deltaCostBasis: bigint;
  /** Cost basis after this event */
  costBasisAfter: bigint;
  /** Change in PnL (always 0 for deposits) */
  deltaPnl: bigint;
  /** PnL after this event (unchanged) */
  pnlAfter: bigint;
  /** Uncollected principal in token0 after this event (unchanged) */
  uncollectedPrincipal0After: bigint;
  /** Uncollected principal in token1 after this event (unchanged) */
  uncollectedPrincipal1After: bigint;
  /** Event-specific state data */
  state: {
    eventType: 'INCREASE_LIQUIDITY';
    tokenId: bigint;
    liquidity: bigint;
    amount0: bigint;
    amount1: bigint;
  };
}

/**
 * Processes an INCREASE_LIQUIDITY event.
 *
 * INCREASE_LIQUIDITY events occur when a user adds liquidity to their position.
 * This increases the cost basis (capital invested) but does not realize any PnL.
 *
 * Financial logic:
 * - Liquidity increases by the amount specified in the event
 * - Cost basis increases by the quote-denominated value of tokens deposited
 * - PnL does not change (no realization on deposit)
 * - Uncollected principal does not change (deposits don't affect collection pool)
 *
 * @param rawEvent - The raw INCREASE_LIQUIDITY event from Etherscan
 * @param previousState - Financial state from the previous event
 * @param sqrtPriceX96 - Historic pool price at event block (Q64.96 format)
 * @param token0IsQuote - True if token0 is the quote token
 * @param token0Decimals - Decimal places for token0
 * @param token1Decimals - Decimal places for token1
 * @returns Processed event result with updated financial state
 *
 * @example
 * ```typescript
 * const result = processIncreaseLiquidityEvent(
 *   rawEvent,
 *   { liquidity: 1000000n, costBasis: 5000000000n, ... },
 *   79228162514264337593543950336n, // sqrtPriceX96
 *   false, // token1 is quote
 *   18, // WETH decimals
 *   6   // USDC decimals
 * );
 * console.log(result.deltaCostBasis); // 1000000000n (1000 USDC added)
 * console.log(result.deltaPnl); // 0n (no PnL on deposit)
 * ```
 */
export function processIncreaseLiquidityEvent(
  rawEvent: RawPositionEvent,
  previousState: PreviousEventState,
  sqrtPriceX96: bigint,
  token0IsQuote: boolean,
  token0Decimals: number,
  token1Decimals: number
): IncreaseLiquidityResult {
  // Parse amounts and liquidity from raw event
  const amount0 = BigInt(rawEvent.amount0 ?? '0');
  const amount1 = BigInt(rawEvent.amount1 ?? '0');
  const deltaL = BigInt(rawEvent.liquidity ?? '0');
  const tokenId = BigInt(rawEvent.tokenId);

  // Update liquidity
  const liquidityAfter = previousState.liquidity + deltaL;

  // Calculate value of deposited tokens in quote token
  const tokenValue = calculateTokenValueInQuote(
    amount0,
    amount1,
    sqrtPriceX96,
    token0IsQuote,
    token0Decimals,
    token1Decimals
  );

  // Increase cost basis by deposited value
  const deltaCostBasis = tokenValue;
  const costBasisAfter = previousState.costBasis + tokenValue;

  // No PnL realization on deposit
  const deltaPnl = 0n;
  const pnlAfter = previousState.pnl;

  // Uncollected principal unchanged (deposits don't affect collection pool)
  const uncollectedPrincipal0After = previousState.uncollectedPrincipal0;
  const uncollectedPrincipal1After = previousState.uncollectedPrincipal1;

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
      eventType: 'INCREASE_LIQUIDITY',
      tokenId,
      liquidity: deltaL,
      amount0,
      amount1,
    },
  };
}
