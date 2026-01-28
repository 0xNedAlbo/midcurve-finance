/**
 * Event Builder Orchestrator for UniswapV3 Position Ledger
 *
 * Orchestrates the building of complete ledger event inputs from raw events.
 */

import { createHash } from 'crypto';
import type { RawPositionEvent } from '../../../../clients/etherscan/types.js';
import type { PreviousEventState } from './state-builder.js';
import type { PoolMetadata } from './pool-metadata.js';
import type { CreateUniswapV3LedgerEventInput } from '../../../types/position-ledger/position-ledger-event-input.js';
import { calculateTokenValueInQuote } from '../../../../utils/uniswapv3/ledger-calculations.js';
import {
  processIncreaseLiquidityEvent,
  type IncreaseLiquidityResult,
} from './event-processors/increase-liquidity.js';
import {
  processDecreaseLiquidityEvent,
  type DecreaseLiquidityResult,
} from './event-processors/decrease-liquidity.js';
import {
  processCollectEvent,
  type CollectResult,
} from './event-processors/collect.js';

/**
 * Parameters for building an event from raw data.
 */
export interface BuildEventParams {
  /** Raw event from Etherscan API */
  rawEvent: RawPositionEvent;
  /** Financial state from previous event */
  previousState: PreviousEventState;
  /** Pool and token metadata */
  poolMetadata: PoolMetadata;
  /** Historic pool price at event block (Q64.96 format) */
  sqrtPriceX96: bigint;
  /** ID of previous event (for chain linkage) */
  previousEventId: string | null;
  /** Position ID */
  positionId: string;
  /** Pool price value (for database reference) */
  poolPrice: bigint;
}

/**
 * Unified result from event processing (union of all processor results).
 */
type EventProcessingResult = IncreaseLiquidityResult | DecreaseLiquidityResult | CollectResult;

/**
 * Builds a complete ledger event input from raw event data.
 *
 * This function orchestrates the entire event building process:
 * 1. Routes event to appropriate processor (INCREASE/DECREASE/COLLECT)
 * 2. Processes event-specific financial calculations
 * 3. Calculates total token value
 * 4. Maps blockchain event type to ledger event type
 * 5. Builds complete event input structure
 * 6. Generates input hash for deduplication
 *
 * @param params - Event building parameters
 * @returns Complete ledger event input ready for database insertion
 *
 * @example
 * ```typescript
 * const eventInput = buildEventInput({
 *   rawEvent,
 *   previousState: {
 *     liquidity: 1000000n,
 *     costBasis: 5000000000n,
 *     pnl: 0n,
 *     uncollectedPrincipal0: 0n,
 *     uncollectedPrincipal1: 0n,
 *   },
 *   poolMetadata,
 *   sqrtPriceX96: 79228162514264337593543950336n,
 *   previousEventId: 'evt_prev',
 *   positionId: 'pos_123',
 *   poolPrice: 1500000000n, // 1500 USDC
 * });
 *
 * // Save to database
 * await ledgerService.addItem(positionId, eventInput);
 * ```
 */
export function buildEventInput(params: BuildEventParams): CreateUniswapV3LedgerEventInput {
  const { rawEvent, previousState, poolMetadata, sqrtPriceX96, previousEventId, positionId, poolPrice } =
    params;

  const { token0, token1, token0IsQuote, token0Decimals, token1Decimals } = poolMetadata;

  // Parse common amounts from raw event
  const amount0 = BigInt(rawEvent.amount0 ?? '0');
  const amount1 = BigInt(rawEvent.amount1 ?? '0');

  // Route to appropriate event processor based on event type
  let result: EventProcessingResult;

  if (rawEvent.eventType === 'INCREASE_LIQUIDITY') {
    result = processIncreaseLiquidityEvent(
      rawEvent,
      previousState,
      sqrtPriceX96,
      token0IsQuote,
      token0Decimals,
      token1Decimals
    );
  } else if (rawEvent.eventType === 'DECREASE_LIQUIDITY') {
    result = processDecreaseLiquidityEvent(
      rawEvent,
      previousState,
      sqrtPriceX96,
      token0IsQuote,
      token0Decimals,
      token1Decimals
    );
  } else {
    // COLLECT
    result = processCollectEvent(
      rawEvent,
      previousState,
      sqrtPriceX96,
      token0,
      token1,
      token0IsQuote,
      token0Decimals,
      token1Decimals
    );
  }

  // Extract common results
  const {
    deltaL,
    liquidityAfter,
    deltaCostBasis,
    costBasisAfter,
    deltaPnl,
    pnlAfter,
    uncollectedPrincipal0After,
    uncollectedPrincipal1After,
    state,
  } = result;

  // Extract rewards (only present in COLLECT events)
  const rewards = 'rewards' in result ? result.rewards : [];

  // Extract fees collected (only present in COLLECT events)
  const feesCollected0 = 'feesCollected0' in result ? result.feesCollected0 : 0n;
  const feesCollected1 = 'feesCollected1' in result ? result.feesCollected1 : 0n;

  // Calculate total token value (for display purposes)
  const tokenValue = calculateTokenValueInQuote(
    amount0,
    amount1,
    sqrtPriceX96,
    token0IsQuote,
    token0Decimals,
    token1Decimals
  );

  // Map blockchain event type to ledger event type
  let ledgerEventType: 'INCREASE_POSITION' | 'DECREASE_POSITION' | 'COLLECT';
  if (rawEvent.eventType === 'INCREASE_LIQUIDITY') {
    ledgerEventType = 'INCREASE_POSITION';
  } else if (rawEvent.eventType === 'DECREASE_LIQUIDITY') {
    ledgerEventType = 'DECREASE_POSITION';
  } else {
    ledgerEventType = 'COLLECT';
  }

  // Build complete event input structure
  const eventInput: Omit<CreateUniswapV3LedgerEventInput, 'inputHash'> = {
    positionId,
    protocol: 'uniswapv3',
    previousId: previousEventId,
    timestamp: rawEvent.blockTimestamp,
    eventType: ledgerEventType,
    poolPrice,
    token0Amount: amount0,
    token1Amount: amount1,
    tokenValue,
    rewards,
    deltaCostBasis,
    costBasisAfter,
    deltaPnl,
    pnlAfter,
    config: {
      chainId: rawEvent.chainId,
      nftId: BigInt(rawEvent.tokenId),
      blockNumber: rawEvent.blockNumber,
      txIndex: Number(rawEvent.transactionIndex),
      logIndex: Number(rawEvent.logIndex),
      txHash: rawEvent.transactionHash,
      deltaL,
      liquidityAfter,
      feesCollected0,
      feesCollected1,
      uncollectedPrincipal0After,
      uncollectedPrincipal1After,
      sqrtPriceX96,
    },
    state,
  };

  // Generate input hash for deduplication (based on blockchain coordinates)
  const inputHash = generateInputHash(eventInput.config);

  return {
    ...eventInput,
    inputHash,
  };
}

/**
 * Generates a unique input hash from event coordinates.
 *
 * The hash is based on blockchain coordinates (block number, tx index, log index)
 * which uniquely identify an event on the blockchain. This is used for deduplication
 * to prevent the same event from being added to the ledger multiple times.
 *
 * @param config - Event config containing blockchain coordinates (only uses blockNumber, txIndex, logIndex)
 * @returns MD5 hash of the coordinates
 *
 * @example
 * ```typescript
 * const hash = generateInputHash({
 *   blockNumber: 12345678n,
 *   txIndex: 5,
 *   logIndex: 3,
 *   // ... other config fields
 * });
 * console.log(hash); // "a1b2c3d4e5f6..."
 * ```
 */
export function generateInputHash(config: {
  blockNumber: bigint;
  txIndex: number | bigint;
  logIndex: number | bigint;
  [key: string]: any; // Allow additional properties
}): string {
  const { blockNumber, txIndex, logIndex } = config;
  const hashInput = `${blockNumber}-${txIndex}-${logIndex}`;
  return createHash('md5').update(hashInput).digest('hex');
}
