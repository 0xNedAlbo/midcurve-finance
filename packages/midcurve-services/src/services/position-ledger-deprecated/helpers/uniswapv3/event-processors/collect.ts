/**
 * COLLECT Event Processor for UniswapV3 Position Ledger
 *
 * Handles processing of COLLECT events where fees and withdrawn principal are collected.
 */

import type { RawPositionEvent } from '../../../../../clients/etherscan/types.js';
import type { PreviousEventState } from '../state-builder.js';
import type { Erc20Token } from '@midcurve/shared';
import {
  calculateTokenValueInQuote,
  separateFeesFromPrincipal,
} from '../../../../../utils/uniswapv3/ledger-calculations.js';

/**
 * Reward (fee) collected in a specific token.
 */
export interface CollectReward {
  /** Token ID from database */
  tokenId: string;
  /** Amount of tokens collected as fees */
  tokenAmount: bigint;
  /** Quote-denominated value of the fee */
  tokenValue: bigint;
}

/**
 * Result of processing a COLLECT event.
 */
export interface CollectResult {
  /** Change in liquidity (always 0 for collect) */
  deltaL: bigint;
  /** Liquidity after this event (unchanged) */
  liquidityAfter: bigint;
  /** Change in cost basis (always 0 for collect) */
  deltaCostBasis: bigint;
  /** Cost basis after this event (unchanged) */
  costBasisAfter: bigint;
  /** Change in PnL (always 0 for collect - no realization) */
  deltaPnl: bigint;
  /** PnL after this event (unchanged) */
  pnlAfter: bigint;
  /** Fees collected in token0 */
  feesCollected0: bigint;
  /** Fees collected in token1 */
  feesCollected1: bigint;
  /** Uncollected principal in token0 after this event (decreased by principal collected) */
  uncollectedPrincipal0After: bigint;
  /** Uncollected principal in token1 after this event (decreased by principal collected) */
  uncollectedPrincipal1After: bigint;
  /** Rewards array (fee collections in each token) */
  rewards: CollectReward[];
  /** Event-specific state data */
  state: {
    eventType: 'COLLECT';
    tokenId: bigint;
    recipient: string;
    amount0: bigint;
    amount1: bigint;
  };
}

/**
 * Processes a COLLECT event.
 *
 * COLLECT events occur when a user collects fees and/or withdrawn principal.
 * The collected amounts are a mix of:
 * 1. Trading fees earned (new capital - tracked as rewards)
 * 2. Previously withdrawn principal from DECREASE_LIQUIDITY events
 *
 * Financial logic:
 * - Liquidity does not change (collection doesn't affect active position)
 * - Cost basis does not change (principal was already accounted for on withdrawal)
 * - PnL does not change (fees are income, not capital gains)
 * - Uncollected principal decreases by principal portion collected
 * - Fees are tracked separately as rewards
 *
 * Separation algorithm:
 * - If collected amount ≤ uncollected principal: all principal, no fees
 * - If collected amount > uncollected principal: principal + fees
 *
 * @param rawEvent - The raw COLLECT event from Etherscan
 * @param previousState - Financial state from the previous event
 * @param sqrtPriceX96 - Historic pool price at event block (Q64.96 format)
 * @param token0 - Token0 metadata (for reward tracking)
 * @param token1 - Token1 metadata (for reward tracking)
 * @param token0IsQuote - True if token0 is the quote token
 * @param token0Decimals - Decimal places for token0
 * @param token1Decimals - Decimal places for token1
 * @returns Processed event result with updated financial state and rewards
 *
 * @example
 * ```typescript
 * const result = processCollectEvent(
 *   rawEvent,
 *   {
 *     liquidity: 2000000n,
 *     costBasis: 10000000000n,
 *     pnl: 500000000n,
 *     uncollectedPrincipal0: 500000000000000000n, // 0.5 ETH withdrawn
 *     uncollectedPrincipal1: 1000000000n // 1000 USDC withdrawn
 *   },
 *   79228162514264337593543950336n,
 *   token0, // WETH
 *   token1, // USDC
 *   false,
 *   18,
 *   6
 * );
 *
 * // If collecting 0.5 ETH + 0.1 ETH fees and 1000 USDC + 100 USDC fees:
 * console.log(result.feesCollected0); // 100000000000000000n (0.1 ETH fees)
 * console.log(result.feesCollected1); // 100000000n (100 USDC fees)
 * console.log(result.uncollectedPrincipal0After); // 0n (all principal collected)
 * console.log(result.rewards.length); // 2 (fees in both tokens)
 * console.log(result.deltaPnl); // 0n (fees are income, not PnL)
 * ```
 */
export function processCollectEvent(
  rawEvent: RawPositionEvent,
  previousState: PreviousEventState,
  sqrtPriceX96: bigint,
  token0: Erc20Token,
  token1: Erc20Token,
  token0IsQuote: boolean,
  token0Decimals: number,
  token1Decimals: number
): CollectResult {
  // Parse amounts from raw event
  const amount0 = BigInt(rawEvent.amount0 ?? '0');
  const amount1 = BigInt(rawEvent.amount1 ?? '0');
  const tokenId = BigInt(rawEvent.tokenId);
  const recipient = rawEvent.recipient ?? '0x0000000000000000000000000000000000000000';

  // Separate fees from principal for both tokens
  const { feeAmount0, feeAmount1, principalAmount0, principalAmount1 } =
    separateFeesFromPrincipal(
      amount0,
      amount1,
      previousState.uncollectedPrincipal0,
      previousState.uncollectedPrincipal1
    );

  const feesCollected0 = feeAmount0;
  const feesCollected1 = feeAmount1;

  // Update uncollected principal (decrease by principal collected)
  const uncollectedPrincipal0After = previousState.uncollectedPrincipal0 - principalAmount0;
  const uncollectedPrincipal1After = previousState.uncollectedPrincipal1 - principalAmount1;

  // Calculate fee values in quote token
  const fee0Value = calculateTokenValueInQuote(
    feeAmount0,
    0n,
    sqrtPriceX96,
    token0IsQuote,
    token0Decimals,
    token1Decimals
  );
  const fee1Value = calculateTokenValueInQuote(
    0n,
    feeAmount1,
    sqrtPriceX96,
    token0IsQuote,
    token0Decimals,
    token1Decimals
  );

  // Build rewards array (only include non-zero fees)
  const rewards: CollectReward[] = [];
  if (feeAmount0 > 0n) {
    rewards.push({
      tokenId: token0.id,
      tokenAmount: feeAmount0,
      tokenValue: fee0Value,
    });
  }
  if (feeAmount1 > 0n) {
    rewards.push({
      tokenId: token1.id,
      tokenAmount: feeAmount1,
      tokenValue: fee1Value,
    });
  }

  // No cost basis or PnL change on collect
  // (Principal was already accounted for on DECREASE_LIQUIDITY, fees are income not capital gains)
  const deltaL = 0n;
  const liquidityAfter = previousState.liquidity;
  const deltaCostBasis = 0n;
  const costBasisAfter = previousState.costBasis;
  const deltaPnl = 0n;
  const pnlAfter = previousState.pnl;

  return {
    deltaL,
    liquidityAfter,
    deltaCostBasis,
    costBasisAfter,
    deltaPnl,
    pnlAfter,
    feesCollected0,
    feesCollected1,
    uncollectedPrincipal0After,
    uncollectedPrincipal1After,
    rewards,
    state: {
      eventType: 'COLLECT',
      tokenId,
      recipient,
      amount0,
      amount1,
    },
  };
}
