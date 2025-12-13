/**
 * Strategy Ledger Event
 *
 * Financial events for strategy positions.
 * Provides a unified event taxonomy for all strategy position types.
 */

import type { StrategyLedgerEventType } from './strategy-ledger-event-type.js';

/**
 * Strategy Ledger Event Interface
 *
 * Represents a single financial event in a strategy's ledger.
 * Events are grouped by `groupId` for atomic transactions.
 */
export interface StrategyLedgerEvent {
  // ============================================================================
  // Identity
  // ============================================================================

  /**
   * Unique identifier (database-generated cuid)
   */
  id: string;

  /**
   * Parent strategy ID
   */
  strategyId: string;

  /**
   * Parent strategy position ID
   */
  strategyPositionId: string;

  // ============================================================================
  // Grouping & Ordering
  // ============================================================================

  /**
   * UUID that groups related events atomically
   *
   * Events in the same group are part of a single logical transaction.
   * Example: A SWAP creates BUY + SELL + FEE_PAID + GAS_PAID events
   * all sharing the same groupId.
   *
   * Cross-position flows (e.g., entering UniswapV3 from HODL) also
   * share a groupId to link the allocation and position entry events.
   */
  groupId: string;

  /**
   * When the event occurred
   *
   * For on-chain events: block timestamp
   * For manual events: user-specified or system-generated timestamp
   */
  timestamp: Date;

  /**
   * Order within the same timestamp
   *
   * Resets per timestamp (0, 1, 2...).
   * Used to maintain deterministic ordering when multiple events
   * occur at the exact same timestamp.
   */
  sequenceNumber: number;

  // ============================================================================
  // Event Identification
  // ============================================================================

  /**
   * Type of financial event
   */
  eventType: StrategyLedgerEventType;

  // ============================================================================
  // Asset
  // ============================================================================

  /**
   * Token database ID
   *
   * Foreign key reference to the Token table.
   */
  tokenId: string;

  /**
   * Token hash for readability/logging
   *
   * Format: "erc20:chainId:address"
   * @example "erc20:1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
   */
  tokenHash: string;

  /**
   * Token amount in smallest units
   *
   * Positive for inflows (deposits, buys, income)
   * Negative for outflows (withdrawals, sells, expenses)
   */
  amount: bigint;

  /**
   * Value in strategy's quote token (smallest units)
   *
   * Allows aggregation across different tokens.
   * Uses price at event time.
   */
  valueInQuote: bigint;

  // ============================================================================
  // Financial Tracking
  // ============================================================================

  /**
   * Change in cost basis from this event
   *
   * Positive: capital invested (deposits, buys)
   * Negative: capital returned (withdrawals, sells)
   *
   * Uses average cost basis methodology.
   */
  deltaCostBasis: bigint;

  /**
   * Change in income from this event
   *
   * Positive: revenue earned (fees, yield, funding received)
   * Negative: revenue paid (funding paid in perpetuals)
   */
  deltaIncome: bigint;

  /**
   * Change in expenses from this event
   *
   * Always positive (costs are expenses).
   * Includes: transaction fees, gas costs, etc.
   */
  deltaExpense: bigint;

  // ============================================================================
  // Protocol-specific Data
  // ============================================================================

  /**
   * Immutable event metadata (JSON)
   *
   * Protocol-specific configuration data that doesn't change.
   * Structure depends on the event type and position type.
   */
  config: Record<string, unknown>;

  /**
   * Event-specific state (JSON)
   *
   * Additional event data.
   * Structure depends on the event type and position type.
   */
  state: Record<string, unknown>;

  // ============================================================================
  // Timestamps
  // ============================================================================

  /**
   * When event was created in database
   */
  createdAt: Date;

  /**
   * When event was last updated in database
   */
  updatedAt: Date;
}

/**
 * JSON-serializable representation of a strategy ledger event
 */
export interface StrategyLedgerEventJSON {
  id: string;
  strategyId: string;
  strategyPositionId: string;
  groupId: string;
  timestamp: string;
  sequenceNumber: number;
  eventType: StrategyLedgerEventType;
  tokenId: string;
  tokenHash: string;
  amount: string;
  valueInQuote: string;
  deltaCostBasis: string;
  deltaIncome: string;
  deltaExpense: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert a strategy ledger event to JSON-safe representation
 */
export function strategyLedgerEventToJSON(event: StrategyLedgerEvent): StrategyLedgerEventJSON {
  return {
    id: event.id,
    strategyId: event.strategyId,
    strategyPositionId: event.strategyPositionId,
    groupId: event.groupId,
    timestamp: event.timestamp.toISOString(),
    sequenceNumber: event.sequenceNumber,
    eventType: event.eventType,
    tokenId: event.tokenId,
    tokenHash: event.tokenHash,
    amount: event.amount.toString(),
    valueInQuote: event.valueInQuote.toString(),
    deltaCostBasis: event.deltaCostBasis.toString(),
    deltaIncome: event.deltaIncome.toString(),
    deltaExpense: event.deltaExpense.toString(),
    config: event.config,
    state: event.state,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

/**
 * Parse a strategy ledger event from JSON representation
 */
export function strategyLedgerEventFromJSON(json: StrategyLedgerEventJSON): StrategyLedgerEvent {
  return {
    id: json.id,
    strategyId: json.strategyId,
    strategyPositionId: json.strategyPositionId,
    groupId: json.groupId,
    timestamp: new Date(json.timestamp),
    sequenceNumber: json.sequenceNumber,
    eventType: json.eventType,
    tokenId: json.tokenId,
    tokenHash: json.tokenHash,
    amount: BigInt(json.amount),
    valueInQuote: BigInt(json.valueInQuote),
    deltaCostBasis: BigInt(json.deltaCostBasis),
    deltaIncome: BigInt(json.deltaIncome),
    deltaExpense: BigInt(json.deltaExpense),
    config: json.config,
    state: json.state,
    createdAt: new Date(json.createdAt),
    updatedAt: new Date(json.updatedAt),
  };
}

/**
 * Database row representation for strategy ledger events
 *
 * Matches the Prisma schema with bigints stored as strings.
 */
export interface StrategyLedgerEventRow {
  id: string;
  strategyId: string;
  strategyPositionId: string;
  groupId: string;
  timestamp: Date;
  sequenceNumber: number;
  eventType: string;
  tokenId: string;
  tokenHash: string;
  amount: string;
  valueInQuote: string;
  deltaCostBasis: string;
  deltaIncome: string;
  deltaExpense: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Convert a database row to a strategy ledger event
 */
export function strategyLedgerEventFromRow(row: StrategyLedgerEventRow): StrategyLedgerEvent {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyPositionId: row.strategyPositionId,
    groupId: row.groupId,
    timestamp: row.timestamp,
    sequenceNumber: row.sequenceNumber,
    eventType: row.eventType as StrategyLedgerEventType,
    tokenId: row.tokenId,
    tokenHash: row.tokenHash,
    amount: BigInt(row.amount),
    valueInQuote: BigInt(row.valueInQuote),
    deltaCostBasis: BigInt(row.deltaCostBasis),
    deltaIncome: BigInt(row.deltaIncome),
    deltaExpense: BigInt(row.deltaExpense),
    config: row.config,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
