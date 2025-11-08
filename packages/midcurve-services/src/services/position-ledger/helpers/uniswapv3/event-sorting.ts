/**
 * Event Sorting Utilities for UniswapV3 Position Ledger
 *
 * Provides chronological sorting of raw position events based on blockchain ordering.
 */

import type { RawPositionEvent } from '../../../../clients/etherscan/types.js';

/**
 * Sorts raw position events chronologically by blockchain ordering.
 *
 * Events are sorted by:
 * 1. Block number (ascending)
 * 2. Transaction index within block (ascending)
 * 3. Log index within transaction (ascending)
 *
 * This ensures events are processed in the exact order they occurred on-chain.
 *
 * @param events - Array of raw position events to sort
 * @returns New array with events sorted chronologically
 *
 * @example
 * ```typescript
 * const events = await etherscanClient.fetchPositionEvents(chainId, nftId);
 * const sorted = sortRawEventsByBlockchain(events);
 * // Process events in chronological order
 * for (const event of sorted) {
 *   await processEvent(event);
 * }
 * ```
 */
export function sortRawEventsByBlockchain(
  events: RawPositionEvent[]
): RawPositionEvent[] {
  return [...events].sort((a, b) => {
    // Compare block numbers
    if (a.blockNumber < b.blockNumber) return -1;
    if (a.blockNumber > b.blockNumber) return 1;

    // Same block: compare transaction index
    if (a.transactionIndex < b.transactionIndex) return -1;
    if (a.transactionIndex > b.transactionIndex) return 1;

    // Same transaction: compare log index
    if (a.logIndex < b.logIndex) return -1;
    if (a.logIndex > b.logIndex) return 1;

    return 0;
  });
}
