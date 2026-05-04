/**
 * UniswapV3 Staking Position Ledger Event
 *
 * Concrete implementation for UniswapV3StakingVault position events.
 * Extends BasePositionLedgerEvent with staking-specific configuration and state.
 */

import { BasePositionLedgerEvent } from '../base-position-ledger-event.js';
import type {
  LedgerEventProtocol,
  EventType,
  BasePositionLedgerEventParams,
  PositionLedgerEventRow,
  PositionLedgerEventJSON,
  RewardJSON,
} from '../position-ledger-event.types.js';
import { rewardFromJSON } from '../position-ledger-event.types.js';
import {
  type UniswapV3StakingLedgerEventConfig,
  type UniswapV3StakingLedgerEventConfigJSON,
  stakingLedgerEventConfigToJSON,
  stakingLedgerEventConfigFromJSON,
} from './uniswapv3-staking-ledger-event-config.js';
import {
  type UniswapV3StakingLedgerEventState,
  type UniswapV3StakingLedgerEventStateJSON,
  stakingLedgerEventStateToJSON,
  stakingLedgerEventStateFromJSON,
} from './uniswapv3-staking-ledger-event-state.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

export interface UniswapV3StakingPositionLedgerEventParams
  extends BasePositionLedgerEventParams {
  config: UniswapV3StakingLedgerEventConfig;
  state: UniswapV3StakingLedgerEventState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

export interface UniswapV3StakingPositionLedgerEventRow
  extends PositionLedgerEventRow {
  protocol: 'uniswapv3-staking';
}

// ============================================================================
// LEDGER EVENT CLASS
// ============================================================================

export class UniswapV3StakingPositionLedgerEvent extends BasePositionLedgerEvent {
  readonly protocol: LedgerEventProtocol = 'uniswapv3-staking';

  private readonly _config: UniswapV3StakingLedgerEventConfig;
  private readonly _state: UniswapV3StakingLedgerEventState;

  constructor(params: UniswapV3StakingPositionLedgerEventParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Config/State Accessors (interface compliance)
  // ============================================================================

  get config(): Record<string, unknown> {
    return stakingLedgerEventConfigToJSON(this._config) as unknown as Record<
      string,
      unknown
    >;
  }

  get state(): Record<string, unknown> {
    return stakingLedgerEventStateToJSON(this._state) as unknown as Record<
      string,
      unknown
    >;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  get typedConfig(): UniswapV3StakingLedgerEventConfig {
    return this._config;
  }

  get typedState(): UniswapV3StakingLedgerEventState {
    return this._state;
  }

  // ============================================================================
  // Convenience Accessors - Config
  // ============================================================================

  get chainId(): number {
    return this._config.chainId;
  }

  get vaultAddress(): string {
    return this._config.vaultAddress;
  }

  get blockNumber(): bigint {
    return this._config.blockNumber;
  }

  get txIndex(): number {
    return this._config.txIndex;
  }

  get logIndex(): number {
    return this._config.logIndex;
  }

  get txHash(): string {
    return this._config.txHash;
  }

  get blockHash(): string {
    return this._config.blockHash;
  }

  get deltaL(): bigint {
    return this._config.deltaL;
  }

  get liquidityAfter(): bigint {
    return this._config.liquidityAfter;
  }

  // ============================================================================
  // Event Properties (from state)
  // ============================================================================

  get poolPrice(): bigint {
    return this._state.poolPrice;
  }

  get tokenAmounts(): bigint[] {
    return this._state.tokenAmounts;
  }

  get token0Amount(): bigint {
    return this._state.tokenAmounts[0] ?? 0n;
  }

  get token1Amount(): bigint {
    return this._state.tokenAmounts[1] ?? 0n;
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  override toJSON(): PositionLedgerEventJSON {
    return {
      ...super.toJSON(),
      poolPrice: this.poolPrice.toString(),
      token0Amount: this.token0Amount.toString(),
      token1Amount: this.token1Amount.toString(),
    };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  static fromDB(
    row: UniswapV3StakingPositionLedgerEventRow,
  ): UniswapV3StakingPositionLedgerEvent {
    const configJSON = row.config as unknown as UniswapV3StakingLedgerEventConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3StakingLedgerEventStateJSON;
    const rewardsJSON = row.rewards as unknown as RewardJSON[];

    return new UniswapV3StakingPositionLedgerEvent({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      positionId: row.positionId,
      previousId: row.previousId,
      timestamp: row.timestamp,
      eventType: row.eventType as EventType,
      inputHash: row.inputHash,
      tokenValue:
        typeof row.tokenValue === 'bigint'
          ? row.tokenValue
          : BigInt(row.tokenValue),
      rewards: rewardsJSON.map(rewardFromJSON),
      deltaCostBasis:
        typeof row.deltaCostBasis === 'bigint'
          ? row.deltaCostBasis
          : BigInt(row.deltaCostBasis),
      costBasisAfter:
        typeof row.costBasisAfter === 'bigint'
          ? row.costBasisAfter
          : BigInt(row.costBasisAfter),
      deltaPnl:
        typeof row.deltaPnl === 'bigint'
          ? row.deltaPnl
          : BigInt(row.deltaPnl),
      pnlAfter:
        typeof row.pnlAfter === 'bigint'
          ? row.pnlAfter
          : BigInt(row.pnlAfter),
      deltaCollectedYield:
        typeof row.deltaCollectedYield === 'bigint'
          ? row.deltaCollectedYield
          : BigInt(row.deltaCollectedYield),
      collectedYieldAfter:
        typeof row.collectedYieldAfter === 'bigint'
          ? row.collectedYieldAfter
          : BigInt(row.collectedYieldAfter),
      deltaRealizedCashflow:
        typeof row.deltaRealizedCashflow === 'bigint'
          ? row.deltaRealizedCashflow
          : BigInt(row.deltaRealizedCashflow),
      realizedCashflowAfter:
        typeof row.realizedCashflowAfter === 'bigint'
          ? row.realizedCashflowAfter
          : BigInt(row.realizedCashflowAfter),
      isIgnored: row.isIgnored ?? false,
      ignoredReason: row.ignoredReason ?? null,
      config: stakingLedgerEventConfigFromJSON(configJSON),
      state: stakingLedgerEventStateFromJSON(stateJSON),
    });
  }
}
