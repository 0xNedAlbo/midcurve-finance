/**
 * Uniswap V3 Position Ledger Event
 *
 * Concrete implementation for Uniswap V3 protocol.
 * Extends BasePositionLedgerEvent with Uniswap V3 specific configuration and state.
 */

import { BasePositionLedgerEvent } from '../base-position-ledger-event.js';
import type {
  LedgerEventProtocol,
  EventType,
  BasePositionLedgerEventParams,
  PositionLedgerEventRow,
  RewardJSON,
} from '../position-ledger-event.types.js';
import { rewardFromJSON } from '../position-ledger-event.types.js';
import {
  type UniswapV3LedgerEventConfig,
  type UniswapV3LedgerEventConfigJSON,
  ledgerEventConfigToJSON,
  ledgerEventConfigFromJSON,
} from './uniswapv3-ledger-event-config.js';
import {
  type UniswapV3LedgerEventState,
  type UniswapV3LedgerEventStateJSON,
  ledgerEventStateToJSON,
  ledgerEventStateFromJSON,
} from './uniswapv3-ledger-event-state.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

/**
 * Parameters for constructing a UniswapV3PositionLedgerEvent.
 */
export interface UniswapV3PositionLedgerEventParams
  extends BasePositionLedgerEventParams {
  config: UniswapV3LedgerEventConfig;
  state: UniswapV3LedgerEventState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * Database row interface for UniswapV3PositionLedgerEvent factory method.
 */
export interface UniswapV3PositionLedgerEventRow extends PositionLedgerEventRow {
  protocol: 'uniswapv3';
}

// ============================================================================
// POSITION LEDGER EVENT CLASS
// ============================================================================

/**
 * UniswapV3PositionLedgerEvent
 *
 * Represents a single event in a Uniswap V3 position's history.
 * Provides type-safe access to Uniswap V3 specific configuration and state.
 *
 * @example
 * ```typescript
 * // From database
 * const event = UniswapV3PositionLedgerEvent.fromDB(row);
 *
 * // Access typed config
 * console.log(event.chainId);        // 1
 * console.log(event.nftId);          // 123456n
 * console.log(event.blockNumber);    // 18000000n
 *
 * // Access typed state (discriminated union)
 * if (event.typedState.eventType === 'INCREASE_LIQUIDITY') {
 *   console.log(event.typedState.liquidity);
 * }
 *
 * // For API response
 * return createSuccessResponse(event.toJSON());
 * ```
 */
export class UniswapV3PositionLedgerEvent extends BasePositionLedgerEvent {
  readonly protocol: LedgerEventProtocol = 'uniswapv3';

  private readonly _config: UniswapV3LedgerEventConfig;
  private readonly _state: UniswapV3LedgerEventState;

  constructor(params: UniswapV3PositionLedgerEventParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Config Accessors (PositionLedgerEventInterface compliance)
  // ============================================================================

  /**
   * Get config as generic Record (for PositionLedgerEventInterface compliance).
   */
  get config(): Record<string, unknown> {
    return ledgerEventConfigToJSON(
      this._config
    ) as unknown as Record<string, unknown>;
  }

  /**
   * Get state as generic Record (for PositionLedgerEventInterface compliance).
   */
  get state(): Record<string, unknown> {
    return ledgerEventStateToJSON(
      this._state
    ) as unknown as Record<string, unknown>;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  /**
   * Get strongly-typed config for internal use.
   */
  get typedConfig(): UniswapV3LedgerEventConfig {
    return this._config;
  }

  /**
   * Get strongly-typed state for internal use.
   */
  get typedState(): UniswapV3LedgerEventState {
    return this._state;
  }

  // ============================================================================
  // Convenience Accessors - Config
  // ============================================================================

  /** Chain ID where the event occurred */
  get chainId(): number {
    return this._config.chainId;
  }

  /** NFT token ID */
  get nftId(): bigint {
    return this._config.nftId;
  }

  /** Block number where event occurred */
  get blockNumber(): bigint {
    return this._config.blockNumber;
  }

  /** Transaction index within the block */
  get txIndex(): number {
    return this._config.txIndex;
  }

  /** Log index within the transaction */
  get logIndex(): number {
    return this._config.logIndex;
  }

  /** Transaction hash */
  get txHash(): string {
    return this._config.txHash;
  }

  /** Change in liquidity (delta L) */
  get deltaL(): bigint {
    return this._config.deltaL;
  }

  /** Total liquidity after this event */
  get liquidityAfter(): bigint {
    return this._config.liquidityAfter;
  }

  /** Fees collected in token0 */
  get feesCollected0(): bigint {
    return this._config.feesCollected0;
  }

  /** Fees collected in token1 */
  get feesCollected1(): bigint {
    return this._config.feesCollected1;
  }

  /** Uncollected principal in token0 after this event */
  get uncollectedPrincipal0After(): bigint {
    return this._config.uncollectedPrincipal0After;
  }

  /** Uncollected principal in token1 after this event */
  get uncollectedPrincipal1After(): bigint {
    return this._config.uncollectedPrincipal1After;
  }

  /** Pool price at event time (sqrtPriceX96) */
  get sqrtPriceX96(): bigint {
    return this._config.sqrtPriceX96;
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create UniswapV3PositionLedgerEvent from database row.
   *
   * @param row - Database row from Prisma
   * @returns UniswapV3PositionLedgerEvent instance
   */
  static fromDB(row: UniswapV3PositionLedgerEventRow): UniswapV3PositionLedgerEvent {
    const configJSON = row.config as unknown as UniswapV3LedgerEventConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3LedgerEventStateJSON;
    const rewardsJSON = row.rewards as unknown as RewardJSON[];

    return new UniswapV3PositionLedgerEvent({
      // Identity
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,

      // Position reference
      positionId: row.positionId,

      // Event chaining
      previousId: row.previousId,

      // Event identification
      timestamp: row.timestamp,
      eventType: row.eventType as EventType,
      inputHash: row.inputHash,

      // Financial data (convert from string stored in DB to bigint)
      poolPrice: typeof row.poolPrice === 'bigint' ? row.poolPrice : BigInt(row.poolPrice),
      token0Amount: typeof row.token0Amount === 'bigint' ? row.token0Amount : BigInt(row.token0Amount),
      token1Amount: typeof row.token1Amount === 'bigint' ? row.token1Amount : BigInt(row.token1Amount),
      tokenValue: typeof row.tokenValue === 'bigint' ? row.tokenValue : BigInt(row.tokenValue),
      rewards: rewardsJSON.map(rewardFromJSON),

      // Cost basis tracking (convert from string stored in DB to bigint)
      deltaCostBasis: typeof row.deltaCostBasis === 'bigint' ? row.deltaCostBasis : BigInt(row.deltaCostBasis),
      costBasisAfter: typeof row.costBasisAfter === 'bigint' ? row.costBasisAfter : BigInt(row.costBasisAfter),

      // PnL tracking (convert from string stored in DB to bigint)
      deltaPnl: typeof row.deltaPnl === 'bigint' ? row.deltaPnl : BigInt(row.deltaPnl),
      pnlAfter: typeof row.pnlAfter === 'bigint' ? row.pnlAfter : BigInt(row.pnlAfter),

      // Protocol-specific
      config: ledgerEventConfigFromJSON(configJSON),
      state: ledgerEventStateFromJSON(stateJSON),
    });
  }
}
