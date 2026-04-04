/**
 * UniswapV3 Vault Position Ledger Event
 *
 * Concrete implementation for vault share position events.
 * Extends BasePositionLedgerEvent with vault-specific configuration and state.
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
  type UniswapV3VaultLedgerEventConfig,
  type UniswapV3VaultLedgerEventConfigJSON,
  vaultLedgerEventConfigToJSON,
  vaultLedgerEventConfigFromJSON,
} from './uniswapv3-vault-ledger-event-config.js';
import {
  type UniswapV3VaultLedgerEventState,
  type UniswapV3VaultLedgerEventStateJSON,
  vaultLedgerEventStateToJSON,
  vaultLedgerEventStateFromJSON,
} from './uniswapv3-vault-ledger-event-state.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

export interface UniswapV3VaultPositionLedgerEventParams
  extends BasePositionLedgerEventParams {
  config: UniswapV3VaultLedgerEventConfig;
  state: UniswapV3VaultLedgerEventState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

export interface UniswapV3VaultPositionLedgerEventRow
  extends PositionLedgerEventRow {
  protocol: 'uniswapv3-vault';
}

// ============================================================================
// POSITION LEDGER EVENT CLASS
// ============================================================================

export class UniswapV3VaultPositionLedgerEvent extends BasePositionLedgerEvent {
  readonly protocol: LedgerEventProtocol = 'uniswapv3-vault';

  private readonly _config: UniswapV3VaultLedgerEventConfig;
  private readonly _state: UniswapV3VaultLedgerEventState;

  constructor(params: UniswapV3VaultPositionLedgerEventParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Config/State Accessors (interface compliance)
  // ============================================================================

  get config(): Record<string, unknown> {
    return vaultLedgerEventConfigToJSON(this._config) as unknown as Record<string, unknown>;
  }

  get state(): Record<string, unknown> {
    return vaultLedgerEventStateToJSON(this._state) as unknown as Record<string, unknown>;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  get typedConfig(): UniswapV3VaultLedgerEventConfig {
    return this._config;
  }

  get typedState(): UniswapV3VaultLedgerEventState {
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

  get shares(): bigint {
    return this._config.shares;
  }

  get sharesAfter(): bigint {
    return this._config.sharesAfter;
  }

  // ============================================================================
  // Event Properties (from state)
  // ============================================================================

  get poolPrice(): bigint {
    return this._state.poolPrice;
  }

  get token0Amount(): bigint {
    return this._state.token0Amount;
  }

  get token1Amount(): bigint {
    return this._state.token1Amount;
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
    row: UniswapV3VaultPositionLedgerEventRow
  ): UniswapV3VaultPositionLedgerEvent {
    const configJSON = row.config as unknown as UniswapV3VaultLedgerEventConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3VaultLedgerEventStateJSON;
    const rewardsJSON = row.rewards as unknown as RewardJSON[];

    return new UniswapV3VaultPositionLedgerEvent({
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
      config: vaultLedgerEventConfigFromJSON(configJSON),
      state: vaultLedgerEventStateFromJSON(stateJSON),
    });
  }
}
