/**
 * UniswapV3 Position Sync State Database Serialization
 *
 * Handles sync state tracking for UniswapV3 positions.
 *
 * The sync state tracks "missing events" - events that were triggered via UI
 * transactions but haven't been fully synced yet. This allows the sync service
 * to determine when a position is fully synchronized.
 *
 * Note: This is a services-layer type. The API layer has a similar
 * UpdateUniswapV3PositionEvent type in @midcurve/api-shared, but we don't
 * create a dependency here to keep the services layer independent.
 */

/**
 * Sync Event State (Database Format)
 *
 * Represents a UniswapV3 position event that was initiated via UI
 * but hasn't been fully synced yet.
 *
 * All bigint values are stored as strings for JSON compatibility.
 */
export interface UniswapV3SyncEventDB {
  eventType: 'INCREASE_LIQUIDITY' | 'DECREASE_LIQUIDITY' | 'COLLECT';
  timestamp: string; // ISO 8601 date string
  blockNumber: string; // bigint as string
  transactionIndex: number;
  logIndex: number;
  transactionHash: string;
  liquidity?: string; // bigint as string (required for INCREASE/DECREASE)
  amount0: string; // bigint as string
  amount1: string; // bigint as string
  recipient?: string; // EIP-55 address (required for COLLECT)
}

/**
 * UniswapV3 Position Sync State (Database Format)
 *
 * Stored in PositionSyncState.state JSON field.
 * Tracks events that were initiated via UI but not yet synced.
 */
export interface UniswapV3SyncStateDB {
  /**
   * Events from UI transactions that need to be synced.
   * Each time a user modifies a position (increase/decrease/collect),
   * the transaction events are added to this list.
   * The sync service processes and removes events once synced.
   */
  missingEvents: UniswapV3SyncEventDB[];
}

/**
 * Convert sync event to DB event format
 *
 * This is an identity function since the input format matches DB format.
 * Kept for consistency with other DB serialization modules.
 *
 * @param event - UniswapV3SyncEventDB
 * @returns UniswapV3SyncEventDB for database storage
 */
export function toSyncEventDB(
  event: UniswapV3SyncEventDB
): UniswapV3SyncEventDB {
  return {
    eventType: event.eventType,
    timestamp: event.timestamp,
    blockNumber: event.blockNumber,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    transactionHash: event.transactionHash,
    liquidity: event.liquidity,
    amount0: event.amount0,
    amount1: event.amount1,
    recipient: event.recipient,
  };
}

/**
 * Convert DB event to sync event format
 *
 * This is an identity function since the formats match.
 * Kept for consistency with other DB serialization modules.
 *
 * @param eventDB - UniswapV3SyncEventDB from database
 * @returns UniswapV3SyncEventDB
 */
export function fromSyncEventDB(
  eventDB: UniswapV3SyncEventDB
): UniswapV3SyncEventDB {
  return {
    eventType: eventDB.eventType,
    timestamp: eventDB.timestamp,
    blockNumber: eventDB.blockNumber,
    transactionIndex: eventDB.transactionIndex,
    logIndex: eventDB.logIndex,
    transactionHash: eventDB.transactionHash,
    liquidity: eventDB.liquidity,
    amount0: eventDB.amount0,
    amount1: eventDB.amount1,
    recipient: eventDB.recipient,
  };
}

/**
 * Create initial empty sync state
 *
 * @returns Empty UniswapV3SyncStateDB
 */
export function createEmptySyncState(): UniswapV3SyncStateDB {
  return {
    missingEvents: [],
  };
}

/**
 * Parse sync state from database JSON
 *
 * @param stateDB - Raw JSON from database
 * @returns Parsed UniswapV3SyncStateDB
 */
export function parseSyncStateDB(stateDB: unknown): UniswapV3SyncStateDB {
  const state = stateDB as UniswapV3SyncStateDB;

  // Validate structure
  if (!state || typeof state !== 'object') {
    return createEmptySyncState();
  }

  if (!Array.isArray(state.missingEvents)) {
    return createEmptySyncState();
  }

  return {
    missingEvents: state.missingEvents,
  };
}

/**
 * Serialize sync state for database storage
 *
 * @param state - UniswapV3SyncStateDB to serialize
 * @returns JSON-serializable object
 */
export function serializeSyncStateDB(state: UniswapV3SyncStateDB): unknown {
  return {
    missingEvents: state.missingEvents,
  };
}
