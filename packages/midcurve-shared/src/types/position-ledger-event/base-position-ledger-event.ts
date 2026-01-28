/**
 * Base Position Ledger Event
 *
 * Abstract base class for position ledger events.
 * Provides common functionality and fields shared across all protocols.
 */

import type { PositionLedgerEventInterface } from './position-ledger-event.interface.js';
import type {
  LedgerEventProtocol,
  EventType,
  Reward,
  PositionLedgerEventJSON,
  BasePositionLedgerEventParams,
} from './position-ledger-event.types.js';
import { rewardToJSON } from './position-ledger-event.types.js';

/**
 * BasePositionLedgerEvent
 *
 * Abstract base class implementing common ledger event functionality.
 * Protocol-specific implementations extend this class.
 *
 * @example
 * ```typescript
 * class UniswapV3PositionLedgerEvent extends BasePositionLedgerEvent {
 *   readonly protocol: LedgerEventProtocol = 'uniswapv3';
 *   // ... protocol-specific implementation
 * }
 * ```
 */
export abstract class BasePositionLedgerEvent
  implements PositionLedgerEventInterface
{
  // ============================================================================
  // DATABASE FIELDS
  // ============================================================================

  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  // ============================================================================
  // POSITION REFERENCE
  // ============================================================================

  readonly positionId: string;

  // ============================================================================
  // EVENT CHAINING
  // ============================================================================

  readonly previousId: string | null;

  // ============================================================================
  // EVENT IDENTIFICATION
  // ============================================================================

  readonly timestamp: Date;
  readonly eventType: EventType;
  readonly inputHash: string;

  // ============================================================================
  // FINANCIAL DATA
  // ============================================================================

  readonly poolPrice: bigint;
  readonly token0Amount: bigint;
  readonly token1Amount: bigint;
  readonly tokenValue: bigint;
  readonly rewards: Reward[];

  // ============================================================================
  // COST BASIS TRACKING
  // ============================================================================

  readonly deltaCostBasis: bigint;
  readonly costBasisAfter: bigint;

  // ============================================================================
  // PNL TRACKING
  // ============================================================================

  readonly deltaPnl: bigint;
  readonly pnlAfter: bigint;

  // ============================================================================
  // COLLECTED FEES TRACKING
  // ============================================================================

  readonly deltaCollectedFees: bigint;
  readonly collectedFeesAfter: bigint;

  // ============================================================================
  // REALIZED CASHFLOW TRACKING (for perpetuals, etc. - always 0 for AMM positions)
  // ============================================================================

  readonly deltaRealizedCashflow: bigint;
  readonly realizedCashflowAfter: bigint;

  // ============================================================================
  // ABSTRACT MEMBERS
  // ============================================================================

  /** Protocol identifier - must be implemented by subclass */
  abstract readonly protocol: LedgerEventProtocol;

  /** Protocol-specific config - must be implemented by subclass */
  abstract get config(): Record<string, unknown>;

  /** Protocol-specific state - must be implemented by subclass */
  abstract get state(): Record<string, unknown>;

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(params: BasePositionLedgerEventParams) {
    this.id = params.id;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
    this.positionId = params.positionId;
    this.previousId = params.previousId;
    this.timestamp = params.timestamp;
    this.eventType = params.eventType;
    this.inputHash = params.inputHash;
    this.poolPrice = params.poolPrice;
    this.token0Amount = params.token0Amount;
    this.token1Amount = params.token1Amount;
    this.tokenValue = params.tokenValue;
    this.rewards = params.rewards;
    this.deltaCostBasis = params.deltaCostBasis;
    this.costBasisAfter = params.costBasisAfter;
    this.deltaPnl = params.deltaPnl;
    this.pnlAfter = params.pnlAfter;
    this.deltaCollectedFees = params.deltaCollectedFees;
    this.collectedFeesAfter = params.collectedFeesAfter;
    this.deltaRealizedCashflow = params.deltaRealizedCashflow;
    this.realizedCashflowAfter = params.realizedCashflowAfter;
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  /**
   * Serialize to JSON for API responses.
   * Converts Date to ISO string and bigint to string.
   */
  toJSON(): PositionLedgerEventJSON {
    return {
      id: this.id,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      positionId: this.positionId,
      protocol: this.protocol,
      previousId: this.previousId,
      timestamp: this.timestamp.toISOString(),
      eventType: this.eventType,
      inputHash: this.inputHash,
      poolPrice: this.poolPrice.toString(),
      token0Amount: this.token0Amount.toString(),
      token1Amount: this.token1Amount.toString(),
      tokenValue: this.tokenValue.toString(),
      rewards: this.rewards.map(rewardToJSON),
      deltaCostBasis: this.deltaCostBasis.toString(),
      costBasisAfter: this.costBasisAfter.toString(),
      deltaPnl: this.deltaPnl.toString(),
      pnlAfter: this.pnlAfter.toString(),
      deltaCollectedFees: this.deltaCollectedFees.toString(),
      collectedFeesAfter: this.collectedFeesAfter.toString(),
      deltaRealizedCashflow: this.deltaRealizedCashflow.toString(),
      realizedCashflowAfter: this.realizedCashflowAfter.toString(),
      config: this.config,
      state: this.state,
    };
  }
}
