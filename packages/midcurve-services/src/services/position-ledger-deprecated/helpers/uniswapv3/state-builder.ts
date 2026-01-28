/**
 * State Management Utilities for UniswapV3 Position Ledger
 *
 * Provides functions for building and managing financial state during event processing.
 */

import type { UniswapV3PositionLedgerEvent } from '@midcurve/shared';

/**
 * Previous event state used for calculating cumulative financial metrics.
 *
 * This interface represents the financial state after the previous event,
 * which becomes the starting point for processing the next event.
 */
export interface PreviousEventState {
  /** Uncollected principal in token0 (fees + withdrawn liquidity not yet collected) */
  uncollectedPrincipal0: bigint;
  /** Uncollected principal in token1 (fees + withdrawn liquidity not yet collected) */
  uncollectedPrincipal1: bigint;
  /** Current active liquidity in the position */
  liquidity: bigint;
  /** Cumulative cost basis in quote token (total capital invested) */
  costBasis: bigint;
  /** Cumulative realized PnL in quote token (profit or loss) */
  pnl: bigint;
}

/**
 * Builds initial state for event processing.
 *
 * If a previous event exists, extracts its final state as the starting point.
 * If no previous event exists (first event), returns zero values.
 *
 * @param lastEvent - The last processed ledger event, or undefined if none exists
 * @returns Initial state object for processing the next event
 *
 * @example
 * ```typescript
 * // First event in position (no previous state)
 * const initialState = buildInitialState(undefined);
 * console.log(initialState.costBasis); // 0n
 *
 * // Subsequent events (continue from last state)
 * const lastEvent = await getLastLedgerEvent(positionId);
 * const state = buildInitialState(lastEvent);
 * console.log(state.costBasis); // 1000000000000000000n (from last event)
 * ```
 */
export function buildInitialState(
  lastEvent: UniswapV3PositionLedgerEvent | undefined
): PreviousEventState {
  if (!lastEvent) {
    // No previous events - start with zero state
    return {
      uncollectedPrincipal0: 0n,
      uncollectedPrincipal1: 0n,
      liquidity: 0n,
      costBasis: 0n,
      pnl: 0n,
    };
  }

  // Extract final state from last event using getters
  return {
    uncollectedPrincipal0: lastEvent.uncollectedPrincipal0After,
    uncollectedPrincipal1: lastEvent.uncollectedPrincipal1After,
    liquidity: lastEvent.liquidityAfter,
    costBasis: lastEvent.costBasisAfter,
    pnl: lastEvent.pnlAfter,
  };
}

/**
 * Extracts the event ID from the last processed event.
 *
 * This ID is used to maintain the event chain linkage (previousId references).
 *
 * @param lastEvent - The last processed ledger event, or undefined if none exists
 * @returns Event ID or null if no previous event
 *
 * @example
 * ```typescript
 * const lastEvent = await getLastLedgerEvent(positionId);
 * const previousId = extractPreviousEventId(lastEvent);
 * // Use in new event: { previousId, ... }
 * ```
 */
export function extractPreviousEventId(
  lastEvent: UniswapV3PositionLedgerEvent | undefined
): string | null {
  return lastEvent?.id ?? null;
}
