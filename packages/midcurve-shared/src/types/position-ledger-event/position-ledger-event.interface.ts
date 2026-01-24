/**
 * Position Ledger Event Interface
 *
 * Defines the contract for position ledger events across all protocols.
 * Ledger events track individual events in a position's history, enabling
 * cost basis tracking, PnL calculations, and fee accounting.
 */

import type {
  LedgerEventProtocol,
  EventType,
  Reward,
  PositionLedgerEventJSON,
} from './position-ledger-event.types.js';

/**
 * PositionLedgerEventInterface
 *
 * Base interface that all position ledger event implementations must satisfy.
 * Provides a common contract for working with ledger events regardless of protocol.
 */
export interface PositionLedgerEventInterface {
  // ============================================================================
  // DATABASE FIELDS
  // ============================================================================

  /** Unique identifier (cuid) */
  readonly id: string;

  /** Timestamp when event was created in database */
  readonly createdAt: Date;

  /** Timestamp when event was last updated in database */
  readonly updatedAt: Date;

  // ============================================================================
  // POSITION REFERENCE
  // ============================================================================

  /** Position this event belongs to (foreign key to Position.id) */
  readonly positionId: string;

  // ============================================================================
  // PROTOCOL IDENTIFICATION
  // ============================================================================

  /** Protocol identifier */
  readonly protocol: LedgerEventProtocol;

  // ============================================================================
  // EVENT CHAINING
  // ============================================================================

  /** Previous event in the chain (null for first event) */
  readonly previousId: string | null;

  // ============================================================================
  // EVENT IDENTIFICATION
  // ============================================================================

  /** Timestamp when event occurred on blockchain */
  readonly timestamp: Date;

  /** Type of event (INCREASE_POSITION, DECREASE_POSITION, COLLECT) */
  readonly eventType: EventType;

  /** Input hash for deduplication */
  readonly inputHash: string;

  // ============================================================================
  // FINANCIAL DATA
  // ============================================================================

  /** Pool price at time of event (quote token units per 1 base token) */
  readonly poolPrice: bigint;

  /** Amount of token0 involved in event */
  readonly token0Amount: bigint;

  /** Amount of token1 involved in event */
  readonly token1Amount: bigint;

  /** Total value of tokens in quote currency */
  readonly tokenValue: bigint;

  /** Rewards collected in this event */
  readonly rewards: Reward[];

  // ============================================================================
  // COST BASIS TRACKING
  // ============================================================================

  /** Change in cost basis from this event */
  readonly deltaCostBasis: bigint;

  /** Total cost basis after this event */
  readonly costBasisAfter: bigint;

  // ============================================================================
  // PNL TRACKING
  // ============================================================================

  /** Change in realized PnL from this event */
  readonly deltaPnl: bigint;

  /** Total realized PnL after this event */
  readonly pnlAfter: bigint;

  // ============================================================================
  // PROTOCOL-SPECIFIC DATA
  // ============================================================================

  /** Protocol-specific configuration (serialized as Record for interface) */
  readonly config: Record<string, unknown>;

  /** Protocol-specific state (serialized as Record for interface) */
  readonly state: Record<string, unknown>;

  // ============================================================================
  // METHODS
  // ============================================================================

  /**
   * Serialize to JSON for API responses.
   * Converts Date to ISO string and bigint to string.
   */
  toJSON(): PositionLedgerEventJSON;
}
