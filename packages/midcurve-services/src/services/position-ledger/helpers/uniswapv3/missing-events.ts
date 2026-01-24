/**
 * Missing Events Utilities
 *
 * Utilities for handling UI-captured events that haven't been indexed by Etherscan yet.
 * These functions merge missing events with Etherscan events, deduplicate, and track confirmation.
 */

import type { UniswapV3SyncEventDB } from '../../../types/uniswapv3/position-sync-state-db.js';
import type { RawPositionEvent } from '../../../../clients/etherscan/types.js';
import type { UniswapV3PositionLedgerEvent } from '@midcurve/shared';

/**
 * Convert sync state event format to raw event format for processing
 *
 * Missing events from UI are stored in a DB-friendly format (strings for bigints).
 * This function converts them to the same format as Etherscan events for uniform processing.
 *
 * @param event - Missing event from sync state (DB format)
 * @param chainId - Chain ID for the event
 * @param tokenId - NFT token ID
 * @returns Raw position event compatible with Etherscan format
 */
export function convertMissingEventToRawEvent(
  event: UniswapV3SyncEventDB,
  chainId: number,
  tokenId: string
): RawPositionEvent {
  const baseEvent: RawPositionEvent = {
    eventType: event.eventType,
    tokenId,
    transactionHash: event.transactionHash,
    blockNumber: BigInt(event.blockNumber),
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    blockTimestamp: new Date(event.timestamp),
    chainId,
  };

  // Add event-specific fields
  if (event.amount0 !== undefined) {
    baseEvent.amount0 = event.amount0;
  }
  if (event.amount1 !== undefined) {
    baseEvent.amount1 = event.amount1;
  }
  if (event.liquidity !== undefined) {
    baseEvent.liquidity = event.liquidity;
  }
  if (event.recipient !== undefined) {
    baseEvent.recipient = event.recipient;
  }

  return baseEvent;
}

/**
 * Merge Etherscan events with missing events
 *
 * Combines two arrays of events into a single array.
 * Does NOT deduplicate - use deduplicateEvents() after merging.
 */
export function mergeEvents(
  etherscanEvents: RawPositionEvent[],
  missingEvents: RawPositionEvent[]
): RawPositionEvent[] {
  return [...etherscanEvents, ...missingEvents];
}

/**
 * Remove duplicate events based on blockchain coordinates
 *
 * Events are uniquely identified by (blockNumber, transactionIndex, logIndex).
 * If duplicates found, keeps the first occurrence.
 *
 * This handles the case where Etherscan catches up and returns an event
 * that's also in the missing events array.
 */
export function deduplicateEvents(
  events: RawPositionEvent[]
): RawPositionEvent[] {
  const seen = new Map<string, RawPositionEvent>();

  for (const event of events) {
    // Create unique key from blockchain coordinates
    const key = `${event.blockNumber}-${event.transactionIndex}-${event.logIndex}`;

    if (!seen.has(key)) {
      seen.set(key, event);
    }
    // If duplicate found (same coordinates), keep first occurrence
  }

  return Array.from(seen.values());
}

/**
 * Find which missing events are now confirmed in the ledger
 *
 * Compares missing events against ledger events by transaction hash.
 * Returns array of unique transaction hashes that are now in the ledger.
 *
 * **Important:** Transactions are atomic - if one event from a transaction is
 * confirmed, ALL events from that transaction are confirmed. This handles
 * common cases like DECREASE_LIQUIDITY + COLLECT in a single multicall.
 *
 * These transaction hashes should be used to remove ALL events with matching
 * txHash from the sync state's missingEvents array.
 */
export function findConfirmedMissingEvents(
  missingEvents: UniswapV3SyncEventDB[],
  ledgerEvents: UniswapV3PositionLedgerEvent[]
): string[] {
  const confirmedTxHashes = new Set<string>();

  for (const missingEvent of missingEvents) {
    // Check if ledger has ANY event from this transaction
    const found = ledgerEvents.some((ledgerEvent) => {
      return (
        ledgerEvent.blockNumber === BigInt(missingEvent.blockNumber) &&
        ledgerEvent.txIndex === missingEvent.transactionIndex
        // NOTE: Not checking logIndex - transaction is atomic!
      );
    });

    if (found) {
      confirmedTxHashes.add(missingEvent.transactionHash);
    }
  }

  return Array.from(confirmedTxHashes);
}
