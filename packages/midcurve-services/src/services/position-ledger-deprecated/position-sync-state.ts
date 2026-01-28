/**
 * UniswapV3 Position Sync State Service
 *
 * Manages sync state for UniswapV3 positions, tracking events that were
 * initiated via UI transactions but haven't been fully synced yet.
 *
 * Usage:
 * ```typescript
 * // Load existing sync state or create empty one
 * const syncState = await UniswapV3PositionSyncState.load(prisma, positionId);
 *
 * // Add events from UI transaction
 * syncState.addMissingEvent(event);
 *
 * // Save to database
 * await syncState.save(prisma);
 * ```
 */

import type { PrismaClient, PositionSyncState } from '@midcurve/database';
import {
  createEmptySyncState,
  fromSyncEventDB,
  parseSyncStateDB,
  serializeSyncStateDB,
  toSyncEventDB,
  type UniswapV3SyncEventDB,
  type UniswapV3SyncStateDB,
} from '../types/uniswapv3/position-sync-state-db.js';

/**
 * UniswapV3 Position Sync State
 *
 * Manages the synchronization state for a UniswapV3 position,
 * tracking events that need to be synced.
 */
export class UniswapV3PositionSyncState {
  private readonly _positionId: string;
  private _state: UniswapV3SyncStateDB;
  private _dbId?: string; // Database record ID (if exists)
  private _lastSyncAt?: Date;
  private _lastSyncBy?: string;

  /**
   * Private constructor - use static load() method instead
   */
  private constructor(
    positionId: string,
    state: UniswapV3SyncStateDB,
    dbId?: string,
    lastSyncAt?: Date,
    lastSyncBy?: string
  ) {
    this._positionId = positionId;
    this._state = state;
    this._dbId = dbId;
    this._lastSyncAt = lastSyncAt;
    this._lastSyncBy = lastSyncBy;
  }

  /**
   * Factory method: Load sync state for a position
   *
   * If no sync state exists in the database, returns a new instance
   * with an empty state.
   *
   * @param prisma - Prisma client instance
   * @param positionId - Position ID to load sync state for
   * @returns UniswapV3PositionSyncState instance
   */
  static async load(
    prisma: PrismaClient,
    positionId: string
  ): Promise<UniswapV3PositionSyncState> {
    const syncState = await prisma.positionSyncState.findUnique({
      where: { positionId },
    });

    if (!syncState) {
      // No sync state exists - return empty instance
      return new UniswapV3PositionSyncState(
        positionId,
        createEmptySyncState()
      );
    }

    // Parse state from database
    const parsedState = parseSyncStateDB(syncState.state);

    return new UniswapV3PositionSyncState(
      positionId,
      parsedState,
      syncState.id,
      syncState.lastSyncAt ?? undefined,
      syncState.lastSyncBy ?? undefined
    );
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Get position ID
   */
  get positionId(): string {
    return this._positionId;
  }

  /**
   * Get all missing events (events that need to be synced)
   */
  get missingEvents(): UniswapV3SyncEventDB[] {
    return this._state.missingEvents.map(fromSyncEventDB);
  }

  /**
   * Get number of missing events
   */
  get missingEventCount(): number {
    return this._state.missingEvents.length;
  }

  /**
   * Check if there are any missing events
   */
  get hasMissingEvents(): boolean {
    return this._state.missingEvents.length > 0;
  }

  /**
   * Get last sync timestamp
   */
  get lastSyncAt(): Date | undefined {
    return this._lastSyncAt;
  }

  /**
   * Get last sync source
   */
  get lastSyncBy(): string | undefined {
    return this._lastSyncBy;
  }

  /**
   * Check if sync state exists in database
   */
  get existsInDb(): boolean {
    return this._dbId !== undefined;
  }

  // ============================================================================
  // Missing Events Management
  // ============================================================================

  /**
   * Add a missing event to the sync state
   *
   * Events are added when a user performs a transaction via the UI
   * (increase liquidity, decrease liquidity, collect fees).
   *
   * @param event - UniswapV3SyncEventDB from the transaction
   */
  addMissingEvent(event: UniswapV3SyncEventDB): void {
    const eventDB = toSyncEventDB(event);
    this._state.missingEvents.push(eventDB);
  }

  /**
   * Add multiple missing events
   *
   * @param events - Array of UniswapV3SyncEventDB
   */
  addMissingEvents(events: UniswapV3SyncEventDB[]): void {
    const eventsDB = events.map(toSyncEventDB);
    this._state.missingEvents.push(...eventsDB);
  }

  /**
   * Remove a missing event by transaction hash and log index
   *
   * Called by the sync service after an event has been processed.
   *
   * @param transactionHash - Transaction hash
   * @param logIndex - Log index
   * @returns true if event was found and removed, false otherwise
   */
  removeMissingEvent(transactionHash: string, logIndex: number): boolean {
    const initialLength = this._state.missingEvents.length;

    this._state.missingEvents = this._state.missingEvents.filter(
      (event) =>
        !(
          event.transactionHash === transactionHash &&
          event.logIndex === logIndex
        )
    );

    return this._state.missingEvents.length < initialLength;
  }

  /**
   * Remove all missing events for a transaction by transaction hash
   *
   * Since transactions are atomic on the blockchain, if one event from a
   * transaction is confirmed, ALL events from that transaction are confirmed.
   * This is the preferred method for cleanup after sync.
   *
   * Common case: DECREASE_LIQUIDITY + COLLECT in a single multicall transaction.
   *
   * @param transactionHash - Transaction hash
   * @returns number of events removed
   */
  removeMissingEventsByTxHash(transactionHash: string): number {
    const initialLength = this._state.missingEvents.length;

    this._state.missingEvents = this._state.missingEvents.filter(
      (event) => event.transactionHash !== transactionHash
    );

    return initialLength - this._state.missingEvents.length;
  }

  /**
   * Clear all missing events
   *
   * Useful after a full re-sync of the position.
   */
  clearMissingEvents(): void {
    this._state.missingEvents = [];
  }

  /**
   * Prune events up to and including a specific block number
   *
   * Removes all events with blockNumber <= the specified block number.
   * This is useful for cleaning up events that have been successfully
   * synced up to a certain block.
   *
   * @param blockNumber - Block number (as bigint or string)
   * @returns Number of events removed
   */
  pruneEvents(blockNumber: bigint | string): number {
    const targetBlock = typeof blockNumber === 'string' ? BigInt(blockNumber) : blockNumber;
    const initialLength = this._state.missingEvents.length;

    this._state.missingEvents = this._state.missingEvents.filter((event) => {
      const eventBlock = BigInt(event.blockNumber);
      return eventBlock > targetBlock;
    });

    return initialLength - this._state.missingEvents.length;
  }

  /**
   * Get missing events sorted by block number and log index
   *
   * @returns Sorted array of missing events
   */
  getMissingEventsSorted(): UniswapV3SyncEventDB[] {
    const sorted = [...this._state.missingEvents].sort((a, b) => {
      // Sort by block number first
      const blockA = BigInt(a.blockNumber);
      const blockB = BigInt(b.blockNumber);

      if (blockA < blockB) return -1;
      if (blockA > blockB) return 1;

      // Same block - sort by transaction index
      if (a.transactionIndex < b.transactionIndex) return -1;
      if (a.transactionIndex > b.transactionIndex) return 1;

      // Same transaction - sort by log index
      return a.logIndex - b.logIndex;
    });

    return sorted.map(fromSyncEventDB);
  }

  // ============================================================================
  // Database Operations
  // ============================================================================

  /**
   * Save sync state to database
   *
   * Creates a new record if it doesn't exist, updates otherwise.
   *
   * @param prisma - Prisma client instance
   * @param syncBy - Source of the sync (e.g., 'user-refresh', 'auto-refresh')
   * @returns Updated PositionSyncState record
   */
  async save(
    prisma: PrismaClient,
    syncBy?: string
  ): Promise<PositionSyncState> {
    const serializedState = serializeSyncStateDB(this._state);
    const now = new Date();

    if (this._dbId) {
      // Update existing record
      const updated = await prisma.positionSyncState.update({
        where: { id: this._dbId },
        data: {
          state: serializedState as any,
          lastSyncAt: now,
          lastSyncBy: syncBy ?? this._lastSyncBy,
          updatedAt: now,
        },
      });

      this._lastSyncAt = updated.lastSyncAt ?? undefined;
      this._lastSyncBy = updated.lastSyncBy ?? undefined;

      return updated;
    } else {
      // Create new record
      const created = await prisma.positionSyncState.create({
        data: {
          positionId: this._positionId,
          state: serializedState as any,
          lastSyncAt: now,
          lastSyncBy: syncBy ?? 'user-refresh',
        },
      });

      this._dbId = created.id;
      this._lastSyncAt = created.lastSyncAt ?? undefined;
      this._lastSyncBy = created.lastSyncBy ?? undefined;

      return created;
    }
  }

  /**
   * Delete sync state from database
   *
   * @param prisma - Prisma client instance
   */
  async delete(prisma: PrismaClient): Promise<void> {
    if (!this._dbId) {
      return; // No record to delete
    }

    await prisma.positionSyncState.delete({
      where: { id: this._dbId },
    });

    this._dbId = undefined;
    this._lastSyncAt = undefined;
    this._lastSyncBy = undefined;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get raw state object (for debugging)
   */
  getRawState(): UniswapV3SyncStateDB {
    return { ...this._state };
  }

  /**
   * Create a plain object representation
   *
   * Useful for logging or API responses.
   */
  toJSON(): {
    positionId: string;
    missingEventCount: number;
    missingEvents: UniswapV3SyncEventDB[];
    lastSyncAt?: string;
    lastSyncBy?: string;
    existsInDb: boolean;
  } {
    return {
      positionId: this._positionId,
      missingEventCount: this.missingEventCount,
      missingEvents: this.missingEvents,
      lastSyncAt: this._lastSyncAt?.toISOString(),
      lastSyncBy: this._lastSyncBy,
      existsInDb: this.existsInDb,
    };
  }
}
